import type {
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  RequestId,
} from "./types.js";

export interface TransportLike {
  send(message: JsonRpcMessage): void;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  onMessage(handler: (message: JsonRpcMessage) => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  onStderr?(handler: (line: string) => void): () => void;
  close(): Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface StdioProcess {
  stdin: { write(data: string): unknown; end(): unknown };
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: string): unknown;
}

type BunRuntime = {
  spawn: (
    args: string[],
    options: {
      cwd: string;
      stderr: "pipe";
      stdin: "pipe";
      stdout: "pipe";
    },
  ) => unknown;
};

type GlobalWithBun = typeof globalThis & {
  Bun?: BunRuntime;
};

export class StdioTransport {
  private readonly messageHandlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly stderrHandlers = new Set<(line: string) => void>();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private nextRequestId = 0;
  private closed = false;
  private closeInitiated = false;
  private readonly stdoutDecoder = new TextDecoder();
  private readonly stderrDecoder = new TextDecoder();
  private readLoopPromise: Promise<void> | null = null;
  private stderrReadLoopPromise: Promise<void> | null = null;

  constructor(private readonly process: StdioProcess) {
    this.readLoopPromise = this.readLoop();
    this.stderrReadLoopPromise = this.readStderrLoop();
    this.process.exited
      .then((code) => {
        if (!this.closeInitiated) {
          this.rejectAllPending(new Error(`codex app-server exited unexpectedly with code ${code}`));
          this.emitError(new Error(`codex app-server exited unexpectedly with code ${code}`));
        }
      })
      .catch((error: unknown) => {
        const normalized = toError(error);
        this.rejectAllPending(normalized);
        this.emitError(normalized);
      });
  }

  static spawn(cwd: string, codexPath = "codex"): StdioTransport {
    const bun = (globalThis as GlobalWithBun).Bun;

    if (bun) {
      const child = bun.spawn([codexPath, "app-server"], {
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      return new StdioTransport(child as unknown as StdioProcess);
    }

    throw new Error("StdioTransport.spawn requires Bun. React Native clients should use WebSocketTransport.");
  }

  send(message: JsonRpcMessage): void {
    if (this.closed) {
      throw new Error("transport is closed");
    }

    const line = `${JSON.stringify(message)}\n`;
    this.process.stdin.write(line);
  }

  onMessage(handler: (message: JsonRpcMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  onStderr(handler: (line: string) => void): () => void {
    this.stderrHandlers.add(handler);
    return () => {
      this.stderrHandlers.delete(handler);
    };
  }

  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextRequestId++;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      id,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out for method ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.send(request);
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closeInitiated = true;
    this.closed = true;

    this.process.stdin.end();

    if (this.readLoopPromise) {
      try {
        await this.readLoopPromise;
      } catch {
        // ignore read-loop errors during close
      }
    }

    if (this.stderrReadLoopPromise) {
      try {
        await this.stderrReadLoopPromise;
      } catch {
        // ignore stderr read-loop errors during close
      }
    }

    try {
      await this.process.exited;
    } catch {
      // ignore process exit errors during close
    }

    this.rejectAllPending(new Error("transport closed"));
  }

  private async readLoop(): Promise<void> {
    await this.readTextStream(this.process.stdout, this.stdoutDecoder, (line) => this.handleLine(line));
  }

  private async readStderrLoop(): Promise<void> {
    await this.readTextStream(this.process.stderr, this.stderrDecoder, (line) => this.emitStderr(line));
  }

  private async readTextStream(
    stream: ReadableStream<Uint8Array> | null,
    decoder: TextDecoder,
    onLine: (line: string) => void,
  ): Promise<void> {
    if (!stream) {
      return;
    }

    const reader = stream.getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        if (line.length > 0) {
          onLine(line);
        }

        newline = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trim();
    if (tail.length > 0) {
      onLine(tail);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emitError(new Error(`Failed to parse JSON-RPC line: ${line}`));
      return;
    }

    if (isJsonRpcResponse(message)) {
      this.resolvePending(message);
    }

    this.emitMessage(message);
  }

  private resolvePending(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(formatJsonRpcError(response.error)));
      return;
    }

    pending.resolve(response.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private emitMessage(message: JsonRpcMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }

  private emitStderr(line: string): void {
    for (const handler of this.stderrHandlers) {
      handler(line);
    }
  }
}

export function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && !("method" in message);
}

export function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

export function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

export function formatJsonRpcError(error: JsonRpcError): string {
  return `${error.code}: ${error.message}`;
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
