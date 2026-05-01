import { formatJsonRpcError, isJsonRpcResponse, toError, type TransportLike } from "./transport.js";
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse, RequestId } from "./types.js";

type WebSocketEventHandler<TEvent> = (event: TEvent) => void;

type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", handler: WebSocketEventHandler<unknown>): void;
  addEventListener(type: "message", handler: WebSocketEventHandler<{ data: unknown }>): void;
  addEventListener(type: "error", handler: WebSocketEventHandler<unknown>): void;
  addEventListener(type: "close", handler: WebSocketEventHandler<{ code?: number; reason?: string }>): void;
};

type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocketLike;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type WebSocketTransportOptions = {
  url: string;
  protocols?: string | string[];
  headers?: Record<string, string>;
  authToken?: string;
  WebSocket?: WebSocketConstructor;
};

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export class WebSocketTransport implements TransportLike {
  private readonly messageHandlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly queuedMessages: string[] = [];
  private readonly socket: WebSocketLike;
  private readonly ready: Promise<void>;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private nextRequestId = 0;
  private closed = false;
  private closeInitiated = false;

  constructor(options: string | WebSocketTransportOptions) {
    const normalized = typeof options === "string" ? { url: options } : options;
    const WebSocketCtor = normalized.WebSocket ?? getGlobalWebSocket();
    const headers = {
      ...normalized.headers,
      ...(normalized.authToken ? { Authorization: `Bearer ${normalized.authToken}` } : {}),
    };

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.socket =
      Object.keys(headers).length > 0
        ? new WebSocketCtor(normalized.url, normalized.protocols, { headers })
        : normalized.protocols
          ? new WebSocketCtor(normalized.url, normalized.protocols)
          : new WebSocketCtor(normalized.url);

    this.socket.addEventListener("open", () => {
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      this.flushQueuedMessages();
    });
    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    this.socket.addEventListener("error", (event) => {
      const error = event instanceof Error ? event : new Error(formatWebSocketErrorEvent(event));
      this.rejectReady?.(error);
      this.emitError(error);
    });
    this.socket.addEventListener("close", (event) => {
      const error = new Error(formatCloseMessage(event.code, event.reason));
      this.closed = true;
      this.rejectReady?.(error);
      this.rejectReady = null;
      this.resolveReady = null;
      this.rejectAllPending(error);

      if (!this.closeInitiated) {
        this.emitError(error);
      }
    });
  }

  send(message: JsonRpcMessage): void {
    if (this.closed || this.socket.readyState === CLOSED) {
      throw new Error("transport is closed");
    }

    const serialized = JSON.stringify(message);

    if (this.socket.readyState === OPEN) {
      this.socket.send(serialized);
      return;
    }

    if (this.socket.readyState === CONNECTING) {
      this.queuedMessages.push(serialized);
      return;
    }

    throw new Error("websocket is not open");
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

  async request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      id,
      ...(params !== undefined ? { params } : {}),
    };

    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out for method ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      this.ready
        .then(() => {
          try {
            this.send(request);
          } catch (error: unknown) {
            clearTimeout(timeout);
            this.pending.delete(id);
            reject(toError(error));
          }
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(toError(error));
        });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closeInitiated = true;
    this.closed = true;
    this.rejectAllPending(new Error("transport closed"));
    this.socket.close();
  }

  private flushQueuedMessages(): void {
    while (this.queuedMessages.length > 0) {
      const message = this.queuedMessages.shift();

      if (message) {
        this.socket.send(message);
      }
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    const raw = await messageDataToString(data);
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      this.emitError(new Error(`Failed to parse JSON-RPC message: ${raw}`));
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
}

function getGlobalWebSocket(): WebSocketConstructor {
  const WebSocketCtor = (globalThis as typeof globalThis & { WebSocket?: WebSocketConstructor }).WebSocket;

  if (!WebSocketCtor) {
    throw new Error("global WebSocket is not available");
  }

  return WebSocketCtor;
}

async function messageDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (data instanceof Blob) {
    return data.text();
  }

  return String(data);
}

function formatCloseMessage(code?: number, reason?: string): string {
  const suffix = reason ? `: ${reason}` : "";
  return `websocket closed${code ? ` (${code})` : ""}${suffix}`;
}

function formatWebSocketErrorEvent(event: unknown): string {
  if (isObject(event)) {
    const message = getString(event, "message") ?? getString(event, "error") ?? getString(event, "type");

    if (message) {
      return `websocket transport error: ${message}`;
    }
  }

  return "websocket transport error";
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const entry = value[key];
  return typeof entry === "string" ? entry : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
