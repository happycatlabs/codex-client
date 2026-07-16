import { describe, expect, test } from "bun:test";
import { CodexClient } from "../client";
import { StdioTransport, type StdioProcess } from "../transport";
import type {
  CodexProcessInfo,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  Thread,
  ThreadItem,
  ThreadItemEntry,
  Turn,
} from "../types";

class MockTransport {
  public readonly sent: JsonRpcMessage[] = [];
  public readonly requests: Array<{ method: string; params?: unknown; timeoutMs?: number }> = [];
  public closed = false;

  private readonly messageHandlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly stderrHandlers = new Set<(line: string) => void>();
  private readonly responders = new Map<string, (params?: unknown) => unknown>();

  constructor(public readonly processInfo?: CodexProcessInfo) {}

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

function makeStdioProcess(pid?: number, exited: Promise<number> = Promise.resolve(0)): StdioProcess {
  return {
    ...(pid !== undefined ? { pid } : {}),
    stdin: {
      write() {
        return undefined;
      },
      end() {
        return undefined;
      },
    },
    stdout: null,
    stderr: null,
    exited,
    kill() {
      return undefined;
    },
  };
}

function withRuntimePlatform<T>(platform: string, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (!descriptor) {
    throw new Error("process.platform descriptor is unavailable");
  }

  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: platform });
    return callback();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
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

  test("processInfo exposes transport identity only while connected", async () => {
    const transport = new MockTransport({ pid: 4321, pgid: 4321 });
    transport.setResponder("initialize", () => ({}));
    const client = new CodexClient({ transportFactory: () => transport });

    expect(client.processInfo).toBeUndefined();
    await client.connect();
    expect(client.processInfo).toEqual({ pid: 4321, pgid: 4321 });
    await client.disconnect();
    expect(client.processInfo).toBeUndefined();
  });

  test("processInfo stays unavailable for transports without a local child", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    const client = new CodexClient({ transportFactory: () => transport });

    await client.connect();
    expect(client.processInfo).toBeUndefined();
    await client.disconnect();
  });

  test("detached defaults false and opt-in reaches the stdio spawn", async () => {
    const originalSpawn = StdioTransport.spawn;
    const detachedValues: boolean[] = [];

    (StdioTransport as unknown as { spawn: typeof StdioTransport.spawn }).spawn = (
      _cwd,
      _codexPath,
      _spawnArgs,
      options = {},
    ) => {
      detachedValues.push(options.detached === true);
      const transport = new MockTransport();
      transport.setResponder("initialize", () => ({}));
      return transport as unknown as StdioTransport;
    };

    try {
      const defaultClient = new CodexClient();
      await defaultClient.connect();
      await defaultClient.disconnect();

      const detachedClient = new CodexClient({ detached: true });
      await detachedClient.connect();
      await detachedClient.disconnect();
    } finally {
      (StdioTransport as unknown as { spawn: typeof StdioTransport.spawn }).spawn = originalSpawn;
    }

    expect(detachedValues).toEqual([false, true]);
  });

  test("startThread forwards current app-server params", async () => {
    const transport = new MockTransport();
    const expected: Thread = { id: "thread-1" };

    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/start", () => ({ thread: expected }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.startThread({
      approvalsReviewer: "auto_review",
      experimentalRawEvents: true,
      sessionStartSource: "startup",
      threadSource: "user",
    });
    expect(result).toEqual(expected);
    expect(transport.requests[1]?.method).toBe("thread/start");
    expect(transport.requests[1]?.params).toEqual(
      expect.objectContaining({
        approvalsReviewer: "auto_review",
        experimentalRawEvents: true,
        sessionStartSource: "startup",
        threadSource: "user",
      }),
    );
  });

  test("startThread omits model when no default is configured", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/start", () => ({ thread: { id: "thread-1" } }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    await client.startThread({});

    const params = transport.requests[1]?.params as Record<string, unknown>;
    expect(params).not.toContainKey("model");
    expect(params).not.toContainKey("experimentalRawEvents");
    expect(params).not.toContainKey("persistExtendedHistory");
  });

  test("startThread sends the configured model", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/start", () => ({ thread: { id: "thread-1" } }));

    const client = new CodexClient({ model: "gpt-5.5", transportFactory: () => transport });
    await client.connect();

    await client.startThread({});
    expect(transport.requests[1]?.params).toEqual(expect.objectContaining({ model: "gpt-5.5" }));

    await client.startThread({ model: "gpt-5.4-mini" });
    expect(transport.requests[2]?.params).toEqual(expect.objectContaining({ model: "gpt-5.4-mini" }));
  });

  test("typed thread lifecycle requests expose current response metadata", async () => {
    const transport = new MockTransport();
    const response = {
      thread: { id: "thread-1" },
      model: "gpt-5.5",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/tmp/project",
      instructionSources: ["/tmp/project/AGENTS.md"],
      approvalPolicy: "never" as const,
      approvalsReviewer: "auto_review" as const,
      sandbox: { type: "workspaceWrite" },
      reasoningEffort: "high",
    };
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/start", () => response);
    transport.setResponder("thread/resume", () => response);
    transport.setResponder("thread/fork", () => response);

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const started = await client.request("thread/start", {});
    const resumed = await client.request("thread/resume", { threadId: "thread-1" });
    const forked = await client.request("thread/fork", { threadId: "thread-1" });

    expect([started.model, resumed.model, forked.model]).toEqual(["gpt-5.5", "gpt-5.5", "gpt-5.5"]);
    expect([started.approvalsReviewer, resumed.approvalsReviewer, forked.approvalsReviewer]).toEqual([
      "auto_review",
      "auto_review",
      "auto_review",
    ]);
    expect(resumed.instructionSources).toEqual(["/tmp/project/AGENTS.md"]);
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

    const result = await client.resumeThread("thread-2", {
      approvalsReviewer: "guardian_subagent",
      excludeTurns: true,
      initialTurnsPage: { itemsView: "summary", limit: 20 },
      path: "/tmp/rollout.jsonl",
    });
    expect(result.id).toBe("thread-2");
    expect(transport.requests[1]?.params).toEqual({
      approvalsReviewer: "guardian_subagent",
      excludeTurns: true,
      initialTurnsPage: { itemsView: "summary", limit: 20 },
      path: "/tmp/rollout.jsonl",
      threadId: "thread-2",
    });
  });

  test("forkThread forwards lastTurnId", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/fork", () => ({ thread: { id: "thread-3", forkedFromId: "thread-2" } }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.forkThread("thread-2", {
      approvalsReviewer: "auto_review",
      ephemeral: true,
      excludeTurns: true,
      lastTurnId: "turn-7",
      path: "/tmp/source-rollout.jsonl",
      threadSource: "subagent",
    });

    expect(result.id).toBe("thread-3");
    expect(transport.requests[1]?.method).toBe("thread/fork");
    expect(transport.requests[1]?.params).toEqual({
      approvalsReviewer: "auto_review",
      ephemeral: true,
      excludeTurns: true,
      lastTurnId: "turn-7",
      path: "/tmp/source-rollout.jsonl",
      threadId: "thread-2",
      threadSource: "subagent",
    });
  });

  test("listThreads forwards current filters and state-db options", async () => {
    const transport = new MockTransport();
    const thread: Thread = {
      id: "thread-1",
      sessionId: "session-1",
      threadSource: "user",
    };
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/list", () => ({
      data: [thread],
      nextCursor: "next",
    }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.listThreads({
      cwd: ["/tmp/project-a", "/tmp/project-b"],
      sortDirection: "desc",
      sourceKinds: ["local"],
      useStateDbOnly: true,
    });

    expect(result).toEqual({
      data: [thread],
      nextCursor: "next",
    });
    expect(transport.requests[1]?.method).toBe("thread/list");
    expect(transport.requests[1]?.params).toEqual({
      cwd: ["/tmp/project-a", "/tmp/project-b"],
      sortDirection: "desc",
      sourceKinds: ["local"],
      useStateDbOnly: true,
    });
  });

  test("listThreadTurns calls the live experimental thread/turns/list method", async () => {
    const transport = new MockTransport();
    const turn: Turn = { id: "turn-1", status: "completed", items: [], itemsView: "summary" };
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
      itemsView: "summary",
    });

    expect(result).toEqual({ data: [turn], nextCursor: "older", backwardsCursor: "newer" });
    expect(transport.requests[1]).toEqual({
      method: "thread/turns/list",
      params: {
        threadId: "thread-1",
        limit: 1,
        sortDirection: "desc",
        itemsView: "summary",
      },
      timeoutMs: 30_000,
    });
  });

  test("listThreadItems preserves stable bare items", async () => {
    const transport = new MockTransport();
    const item: ThreadItem = { type: "agentMessage", id: "item-1", text: "done" };
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/items/list", () => ({
      data: [item, { id: "missing-type" }],
      nextCursor: null,
      backwardsCursor: "newer-items",
    }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const acrossThread = await client.listThreadItems({
      threadId: "thread-1",
      limit: 100,
      sortDirection: "asc",
    });
    const oneTurn = await client.listThreadTurnItems({
      threadId: "thread-1",
      turnId: "turn-1",
    });

    expect(acrossThread).toEqual({ data: [item], nextCursor: null, backwardsCursor: "newer-items" });
    expect(oneTurn.data).toEqual([item]);
    expect(transport.requests.slice(1).map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: "thread/items/list",
        params: { threadId: "thread-1", limit: 100, sortDirection: "asc" },
      },
      {
        method: "thread/items/list",
        params: { threadId: "thread-1", turnId: "turn-1" },
      },
    ]);
  });

  test("listThreadItems preserves 0.145 entry envelopes while the deprecated helper unwraps them", async () => {
    const transport = new MockTransport();
    const item: ThreadItem = { type: "agentMessage", id: "item-1", text: "done" };
    const entry: ThreadItemEntry = { turnId: "turn-1", item };
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/items/list", () => ({
      data: [entry, { turnId: "turn-2", item: { id: "missing-type" } }],
      nextCursor: "older-items",
    }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const acrossThread = await client.listThreadItems({ threadId: "thread-1" });
    const oneTurn = await client.listThreadTurnItems({ threadId: "thread-1", turnId: "turn-1" });

    expect(acrossThread).toEqual({ data: [entry], nextCursor: "older-items" });
    expect(oneTurn).toEqual({ data: [item], nextCursor: "older-items" });
  });

  test("deleteThread calls thread/delete", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("thread/delete", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    await client.deleteThread("thread-1");

    expect(transport.requests[1]?.method).toBe("thread/delete");
    expect(transport.requests[1]?.params).toEqual({ threadId: "thread-1" });
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
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
    });

    expect(result).toEqual(turn);
    expect(transport.requests[1]?.params).toEqual({
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }],
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
    });
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

  test("emits context-rich mcp tool progress notifications", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const legacyProgress: unknown[] = [];
    const notificationProgress: unknown[] = [];

    client.on("item:mcpToolCall:progress", (payload) => {
      legacyProgress.push(payload);
    });
    client.on("item:mcpToolCall:progress:notification", (payload) => {
      notificationProgress.push(payload);
    });

    transport.emitNotification("item/mcpToolCall/progress", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "mcp-1",
      message: "Taking screenshot",
    });

    expect(legacyProgress).toEqual([{ itemId: "mcp-1", message: "Taking screenshot" }]);
    expect(notificationProgress).toEqual([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "mcp-1",
        message: "Taking screenshot",
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

  test("emits plan deltas for item/plan/delta with legacy aliases", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    const legacy: unknown[] = [];
    client.on("item:plan:delta", (payload) => {
      received.push(payload);
    });
    client.on("turn:plan:delta", (payload) => {
      legacy.push(payload);
    });

    const params = {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "plan-1",
      delta: "1. Do the thing",
    };

    transport.emitNotification("item/plan/delta", params);

    expect(received).toEqual([params]);
    expect(legacy).toEqual([params]);
  });

  test("emits turn:error for error notifications", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("turn:error", (payload) => {
      received.push(payload);
    });

    transport.emitNotification("error", {
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: false,
      error: {
        message: "You've hit your usage limit.",
        codexErrorInfo: "usageLimitExceeded",
        additionalDetails: null,
      },
    });

    expect(received).toEqual([
      {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: {
          message: "You've hit your usage limit.",
          codexErrorInfo: "usageLimitExceeded",
          additionalDetails: null,
        },
      },
    ]);
  });

  test("emits raw notification events so unknown methods stay observable", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("notification", (message) => {
      received.push(message);
    });

    transport.emitNotification("thread/settings/updated", { threadId: "thread-1" });

    expect(received).toEqual([
      {
        jsonrpc: "2.0",
        method: "thread/settings/updated",
        params: { threadId: "thread-1" },
      },
    ]);
  });

  test("emits command execution approval requests and responds with decision", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("request:commandExecutionApproval", (payload) => {
      received.push(payload);
      client.respondToCommandExecutionApproval(payload.requestId, "accept");
    });

    transport.emitRequest("item/commandExecution/requestApproval", "req-2", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      startedAtMs: 1_752_000_000_000,
      command: "rm -rf node_modules",
      cwd: "/tmp/project",
      reason: null,
    });

    expect(received).toEqual([
      {
        requestId: "req-2",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        startedAtMs: 1_752_000_000_000,
        command: "rm -rf node_modules",
        cwd: "/tmp/project",
        reason: null,
      },
    ]);

    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: "req-2",
      result: { decision: "accept" },
    });
  });

  test("emits file change approval requests and responds with decision", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const received: unknown[] = [];
    client.on("request:fileChangeApproval", (payload) => {
      received.push(payload);
      client.respondToFileChangeApproval(payload.requestId, "decline");
    });

    transport.emitRequest("item/fileChange/requestApproval", 7, {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-2",
      grantRoot: "/tmp/project",
    });

    expect(received).toEqual([
      {
        requestId: 7,
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        grantRoot: "/tmp/project",
      },
    ]);

    expect(transport.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { decision: "decline" },
    });
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

  test("listCollaborationModes calls the live experimental method", async () => {
    const transport = new MockTransport();
    transport.setResponder("initialize", () => ({}));
    transport.setResponder("collaborationMode/list", () => ({
      data: [
        { name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
        { name: "Default", mode: "default", model: null, reasoning_effort: null },
      ],
    }));

    const client = new CodexClient({ transportFactory: () => transport });
    await client.connect();

    const result = await client.listCollaborationModes();

    expect(result.data.map((mode) => mode.name)).toEqual(["Plan", "Default"]);
    expect(transport.requests[1]?.method).toBe("collaborationMode/list");
    expect(transport.requests[1]?.params).toEqual({});
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
  test("reports pid and detached pgid only when process identity is valid", async () => {
    const attached = new StdioTransport(makeStdioProcess(4101));
    const detached = new StdioTransport(makeStdioProcess(4102), { detached: true });
    const unavailable = new StdioTransport(makeStdioProcess());
    const invalid = new StdioTransport(makeStdioProcess(-1), { detached: true });
    const windowsDetached = withRuntimePlatform(
      "win32",
      () => new StdioTransport(makeStdioProcess(4103), { detached: true }),
    );

    expect(attached.processInfo).toEqual({ pid: 4101 });
    expect(detached.processInfo).toEqual({ pid: 4102, pgid: 4102 });
    expect(windowsDetached.processInfo).toEqual({ pid: 4103 });
    expect(unavailable.processInfo).toBeUndefined();
    expect(invalid.processInfo).toBeUndefined();

    await Promise.all([
      attached.close(),
      detached.close(),
      windowsDetached.close(),
      unavailable.close(),
      invalid.close(),
    ]);
  });

  test("Bun spawn receives the detached default and opt-in", async () => {
    const mutableBun = Bun as unknown as {
      spawn: (args: string[], options: Record<string, unknown>) => unknown;
    };
    const originalSpawn = mutableBun.spawn;
    const calls: Array<{ args: string[]; options: Record<string, unknown> }> = [];
    let nextPid = 5100;

    mutableBun.spawn = (args, options) => {
      calls.push({ args, options });
      nextPid += 1;
      return makeStdioProcess(nextPid);
    };

    let attached: StdioTransport | undefined;
    let detached: StdioTransport | undefined;
    try {
      attached = StdioTransport.spawn("/tmp/project", "codex-test", ["proxy"]);
      detached = StdioTransport.spawn("/tmp/project", "codex-test", [], { detached: true });

      expect(calls).toEqual([
        {
          args: ["codex-test", "app-server", "proxy"],
          options: {
            cwd: "/tmp/project",
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            detached: false,
          },
        },
        {
          args: ["codex-test", "app-server"],
          options: {
            cwd: "/tmp/project",
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            detached: true,
          },
        },
      ]);
      expect(attached.processInfo).toEqual({ pid: 5101 });
      expect(detached.processInfo).toEqual({ pid: 5102, pgid: 5102 });
    } finally {
      mutableBun.spawn = originalSpawn;
      await Promise.all([attached?.close(), detached?.close()]);
    }
  });

  test("falls back to Node child_process via getBuiltinModule when Bun is absent", async () => {
    const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
    const stdinWrites: string[] = [];
    let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stdoutWeb = new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller;
      },
    });
    const stderrWeb = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const fakeChild = {
      pid: 6201,
      stdin: {
        write(data: string) {
          stdinWrites.push(data);
          return true;
        },
        end() {
          return undefined;
        },
      },
      stdout: { fake: "stdout" },
      stderr: { fake: "stderr" },
      once(event: string, listener: (code: number | null, signal: string | null) => void) {
        if (event === "exit") {
          exitListeners.push(listener);
        }
        return fakeChild;
      },
      kill() {
        return true;
      },
    };

    const fakeModules: Record<string, unknown> = {
      "node:child_process": {
        spawn(command: string, args: string[], options: Record<string, unknown>) {
          spawnCalls.push({ command, args, options });
          return fakeChild;
        },
      },
      "node:stream": {
        Readable: {
          toWeb: (stream: unknown) => (stream === fakeChild.stdout ? stdoutWeb : stderrWeb),
        },
      },
      "node:os": { constants: { signals: { SIGTERM: 15 } } },
    };

    const runtime = { process: { getBuiltinModule: (id: string) => fakeModules[id] } };

    let transport: StdioTransport | undefined;
    try {
      transport = StdioTransport.spawnWithRuntime(runtime, "/tmp/project", "codex-test", ["proxy"], {
        detached: true,
      });

      expect(spawnCalls).toEqual([
        {
          command: "codex-test",
          args: ["app-server", "proxy"],
          options: { cwd: "/tmp/project", detached: true, stdio: ["pipe", "pipe", "pipe"] },
        },
      ]);
      expect(transport.processInfo).toEqual({ pid: 6201, pgid: 6201 });

      const pending = transport.request("thread/start", { cwd: "/tmp/project" });
      const sent = JSON.parse(stdinWrites[0] ?? "{}") as { id: number };
      stdoutController?.enqueue(
        new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { ok: true } })}\n`),
      );
      expect(await pending).toEqual({ ok: true });

      // Signal deaths must resolve exited as 128 + signal number, matching Bun.
      const errors: string[] = [];
      transport.onError((error) => {
        errors.push(error.message);
      });
      for (const listener of exitListeners) {
        listener(null, "SIGTERM");
      }
      await Promise.resolve();
      expect(errors).toEqual(["codex app-server exited unexpectedly with code 143"]);
    } finally {
      stdoutController?.close();
      await transport?.close();
    }
  });

  test("spawn throws a runtime-support error when neither Bun nor getBuiltinModule exists", () => {
    expect(() => StdioTransport.spawnWithRuntime({}, "/tmp/project")).toThrow(
      "StdioTransport.spawn requires Bun or Node.js 20.16+ (process.getBuiltinModule). React Native clients should use WebSocketTransport.",
    );
  });

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
