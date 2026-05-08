import { describe, expect, test } from "bun:test";
import { CodexClient } from "../client";
import { StdioTransport, type StdioProcess } from "../transport";
import type { JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, Thread, ThreadItem, Turn } from "../types";

class MockTransport {
  public readonly sent: JsonRpcMessage[] = [];
  public readonly requests: Array<{ method: string; params?: unknown; timeoutMs?: number }> = [];
  public closed = false;

  private readonly messageHandlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly stderrHandlers = new Set<(line: string) => void>();
  private readonly responders = new Map<string, (params?: unknown) => unknown>();

  send(message: JsonRpcMessage): void {
    this.sent.push(message);
  }

  async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    this.requests.push({ method, params, timeoutMs });
    const responder = this.responders.get(method);

    if (!responder) {
      return {};
    }

    return responder(params);
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

  async close(): Promise<void> {
    this.closed = true;
  }

  setResponder(method: string, responder: (params?: unknown) => unknown): void {
    this.responders.set(method, responder);
  }

  emitNotification(method: string, params?: unknown): void {
    const message: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  emitRequest(method: string, id: string | number, params?: unknown): void {
    const message: JsonRpcRequest = { jsonrpc: "2.0", method, id, params };
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }

  emitStderr(line: string): void {
    for (const handler of this.stderrHandlers) {
      handler(line);
    }
  }
}

describe("CodexClient unit", () => {
  test("initialize handshake", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({ userAgent: "openclaw/0.1.0" }));

    const client = new CodexClient({
      transportFactory: () => transport,
    });

    await client.connect();

    expect(transport.requests[0]?.method).toBe("initialize");
    expect(transport.requests[0]?.params).toEqual({
      clientInfo: {
        name: "openclaw",
        title: "OpenClaw",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    expect(transport.sent).toContainEqual({ jsonrpc: "2.0", method: "initialized" });
  });

  test("startThread", async () => {
    const transport = new MockTransport();
    const expected: Thread = { id: "thread-1" };

    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/start", () => ({ thread: expected }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.startThread({});
    expect(result).toEqual(expected);
    expect(transport.requests[1]?.method).toBe("thread/start");
  });

  test("re-emits stderr lines for consumers that subscribe", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    const received: string[] = [];
    client.on("stderr", (line) => {
      received.push(String(line));
    });

    await client.connect();
    transport.emitStderr("codex warning");

    expect(received).toEqual(["codex warning"]);
  });

  test("emits user-input server requests and responds with answers", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("request:userInput", (payload) => {
      received.push(payload);
      client.respondToUserInputRequest("req-1", {
        answers: {
          clarification: {
            answers: ["use migration A"],
          },
        },
      });
    });

    transport.emitRequest("item/tool/requestUserInput", "req-1", {
      itemId: "item-1",
      threadId: "thread-1",
      turnId: "turn-1",
      questions: [
        {
          header: "Schema",
          id: "clarification",
          question: "Which migration should I use?",
          isOther: true,
          options: [
            { label: "A", description: "Use migration A" },
            { label: "B", description: "Use migration B" },
          ],
        },
      ],
    });

    expect(received).toEqual([
      {
        requestId: "req-1",
        itemId: "item-1",
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            header: "Schema",
            id: "clarification",
            question: "Which migration should I use?",
            isOther: true,
            options: [
              { label: "A", description: "Use migration A" },
              { label: "B", description: "Use migration B" },
            ],
          },
        ],
      },
    ]);

    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: "req-1",
      result: {
        answers: {
          clarification: {
            answers: ["use migration A"],
          },
        },
      },
    });
  });

  test("resumeThread", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/resume", () => ({ thread: { id: "thread-2" } }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.resumeThread("thread-2");
    expect(result.id).toBe("thread-2");
    expect(transport.requests[1]?.params).toEqual({
      threadId: "thread-2",
    });
  });

  test("resumeThread forwards excludeTurns when paging history separately", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/resume", () => ({ thread: { id: "thread-2", turns: [] } }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    await client.resumeThread("thread-2", { excludeTurns: true });

    expect(transport.requests[1]?.method).toBe("thread/resume");
    expect(transport.requests[1]?.params).toEqual({
      excludeTurns: true,
      threadId: "thread-2",
    });
  });

  test("forkThread forwards excludeTurns", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/fork", () => ({ thread: { id: "thread-3", forkedFromId: "thread-2" } }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.forkThread("thread-2", { ephemeral: true, excludeTurns: true });

    expect(result.id).toBe("thread-3");
    expect(transport.requests[1]?.method).toBe("thread/fork");
    expect(transport.requests[1]?.params).toEqual({
      ephemeral: true,
      excludeTurns: true,
      threadId: "thread-2",
    });
  });

  test("listThreadTurns calls thread/turns/list", async () => {
    const transport = new MockTransport();
    const turn: Turn = { id: "turn-1", status: "completed", items: [] };
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/turns/list", () => ({
      data: [turn],
      nextCursor: "older",
      backwardsCursor: "newer",
    }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.listThreadTurns({
      threadId: "thread-1",
      limit: 1,
      sortDirection: "desc",
    });

    expect(result).toEqual({
      data: [turn],
      nextCursor: "older",
      backwardsCursor: "newer",
    });
    expect(transport.requests[1]?.method).toBe("thread/turns/list");
  });

  test("startTurn", async () => {
    const transport = new MockTransport();
    const turn: Turn = { id: "turn-1", status: "inProgress", items: [] };

    transport.setResponder("initialize", () => ({}));
    transport.setResponder("turn/start", () => ({ turn }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.startTurn({
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }],
    });

    expect(result).toEqual(turn);
  });

  test("runTurn collects items", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("turn/start", () => ({ turn: { id: "turn-1", status: "inProgress", items: [] } }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const promise = client.runTurn({
      threadId: "thread-1",
      input: [{ type: "text", text: "echo hello world" }],
    });

    const item: ThreadItem = {
      type: "agentMessage",
      id: "item-1",
      text: "hello world",
    };

    transport.emitNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "inProgress", items: [] },
    });
    transport.emitNotification("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item,
    });
    transport.emitNotification("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "hello world",
    });
    transport.emitNotification("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item,
    });
    transport.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed", items: [item] },
    });

    const completed = await promise;

    expect(completed.turn.id).toBe("turn-1");
    expect(completed.items).toHaveLength(1);
    expect(completed.agentMessage).toBe("hello world");
  });

  test("emits context-rich turn and item notification events alongside legacy payloads", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const legacyItems: unknown[] = [];
    const itemNotifications: unknown[] = [];
    const turnNotifications: unknown[] = [];

    client.on("item:completed", (item) => {
      legacyItems.push(item);
    });
    client.on("item:completed:notification", (payload) => {
      itemNotifications.push(payload);
    });
    client.on("turn:completed:notification", (payload) => {
      turnNotifications.push(payload);
    });

    const item: ThreadItem = {
      type: "agentMessage",
      id: "item-1",
      text: "hello",
    };
    const turn: Turn = { id: "turn-1", status: "completed", items: [item] };

    transport.emitNotification("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item,
    });
    transport.emitNotification("turn/completed", {
      threadId: "thread-1",
      turn,
    });

    expect(legacyItems).toEqual([item]);
    expect(itemNotifications).toEqual([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        item,
      },
    ]);
    expect(turnNotifications).toEqual([
      {
        threadId: "thread-1",
        turn,
      },
    ]);
  });

  test("emits raw response item completion notifications", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const legacyItems: unknown[] = [];
    const notifications: unknown[] = [];

    client.on("rawResponseItem:completed", (item) => {
      legacyItems.push(item);
    });
    client.on("rawResponseItem:completed:notification", (payload) => {
      notifications.push(payload);
    });

    const item = {
      call_id: "call-1",
      output: [{ type: "input_image", image_url: "data:image/png;base64,abc" }],
      type: "function_call_output",
    } as const;

    transport.emitNotification("rawResponseItem/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item,
    });

    expect(legacyItems).toEqual([item]);
    expect(notifications).toEqual([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        item,
      },
    ]);
  });

  test("emits context-rich command output delta notifications", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const legacyDeltas: unknown[] = [];
    const notificationDeltas: unknown[] = [];

    client.on("item:commandExecution:outputDelta", (payload) => {
      legacyDeltas.push(payload);
    });
    client.on("item:commandExecution:outputDelta:notification", (payload) => {
      notificationDeltas.push(payload);
    });

    transport.emitNotification("item/commandExecution/outputDelta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "command-1",
      delta: "output",
    });

    expect(legacyDeltas).toEqual([{ itemId: "command-1", delta: "output" }]);
    expect(notificationDeltas).toEqual([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        delta: "output",
      },
    ]);
  });

  test("emits object-shaped thread status notifications", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("thread:status:changed", (payload) => {
      received.push(payload);
    });

    transport.emitNotification("thread/status/changed", {
      threadId: "thread-1",
      status: { type: "active", activeFlags: ["waitingOnUserInput"] },
    });

    expect(received).toEqual([
      {
        threadId: "thread-1",
        status: { type: "active", activeFlags: ["waitingOnUserInput"] },
      },
    ]);
  });

  test("steerTurn", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("turn/steer", () => ({ turnId: "turn-2" }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const turnId = await client.steerTurn({
      threadId: "thread-1",
      input: [{ type: "text", text: "continue" }],
      expectedTurnId: "turn-1",
    });

    expect(turnId).toBe("turn-2");
  });

  test("interruptTurn", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("turn/interrupt", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    await client.interruptTurn("thread-1", "turn-1");

    expect(transport.requests[1]?.method).toBe("turn/interrupt");
    expect(transport.requests[1]?.params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  test("error response rejects", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => {
      throw new Error("-32603: boom");
    });

    const client = new CodexClient({ transportFactory: () => transport });

    await expect(client.connect()).rejects.toThrow("boom");
  });

  test("compactThread uses thread/compact/start", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/compact/start", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    await client.compactThread("thread-1");

    expect(transport.requests[1]?.method).toBe("thread/compact/start");
    expect(transport.requests[1]?.params).toEqual({ threadId: "thread-1" });
  });

  test("listSkills calls skills/list", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("skills/list", () => ({
      data: [{ cwd: "/tmp", skills: [], errors: [] }],
    }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.listSkills({ cwds: ["/tmp"], forceReload: true });

    expect(result.data).toEqual([{ cwd: "/tmp", skills: [], errors: [] }]);
    expect(transport.requests[1]?.method).toBe("skills/list");
  });

  test("command exec string commands are normalized through a shell", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("command/exec", () => ({ exitCode: 0, stdout: "", stderr: "" }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    await client.execCommand({ command: "echo hello" });

    const request = transport.requests[1];
    expect(request?.method).toBe("command/exec");
    expect(request?.params).toMatchObject({
      command: [expect.any(String), "-lc", "echo hello"],
    });
  });

  test("emits command exec output deltas", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("command:exec:outputDelta", (payload) => {
      received.push(payload);
    });

    transport.emitNotification("command/exec/outputDelta", {
      processId: "proc-1",
      stream: "stdout",
      deltaBase64: "aGVsbG8=",
      capReached: false,
    });

    expect(received).toEqual([
      {
        processId: "proc-1",
        stream: "stdout",
        deltaBase64: "aGVsbG8=",
        capReached: false,
      },
    ]);
  });
});

describe("StdioTransport", () => {
  test("process exit rejects pending", async () => {
    let resolveExit: ((value: number) => void) | undefined;

    const stdout = new ReadableStream<Uint8Array>({
      start() {
        // keep open for this test
      },
    });

    const process: StdioProcess = {
      stdin: {
        write() {
          return undefined;
        },
        end() {
          return undefined;
        },
      },
      stdout,
      stderr: null,
      exited: new Promise<number>((resolve) => {
        resolveExit = resolve;
      }),
      kill() {
        return undefined;
      },
    };

    const transport = new StdioTransport(process);

    const pending = transport.request("thread/list", undefined, 5_000);
    resolveExit?.(1);

    await expect(pending).rejects.toThrow("exited unexpectedly");
  });
});
