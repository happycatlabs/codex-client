import { EventEmitter } from "node:events";
import { StdioTransport, isJsonRpcNotification, isJsonRpcRequest } from "./transport.js";
import type {
  AgentMessageDeltaNotification,
  AppInfo,
  AppListParams,
  AppListResult,
  AppListUpdatedNotification,
  CodexClientOptions,
  CollaborationModeListResult,
  CommandExecOutputDeltaNotification,
  CommandExecResizeParams,
  CommandExecTerminateParams,
  CommandExecWriteParams,
  CommandOutputDeltaNotification,
  CompletedReview,
  CompletedTurn,
  ConfigBatchWriteParams,
  ConfigReadParams,
  ConfigReadResult,
  ConfigRequirementsReadResult,
  ConfigValueWriteParams,
  ConfigWriteResult,
  DiffUpdatedNotification,
  ExecCommandParams,
  ExecCommandResult,
  ExperimentalFeatureListParams,
  ExperimentalFeatureListResult,
  ForkThreadParams,
  InitializeParams,
  InitializeResponse,
  ItemNotification,
  JsonRpcMessage,
  JsonRpcRequest,
  ListLoadedThreadsParams,
  ListModelsParams,
  ListThreadsParams,
  ModelInfo,
  ModelListResult,
  PlanDeltaNotification,
  PlanUpdatedNotification,
  RequestId,
  ReviewResult,
  ResumeThreadParams,
  ServerRequestResolvedNotification,
  SkillsListParams,
  SkillsListResult,
  StartReviewParams,
  StartThreadParams,
  StartTurnParams,
  SteerTurnParams,
  Thread,
  ThreadItem,
  ThreadLifecycleNotification,
  ThreadListResult,
  ThreadLoadedListResult,
  ThreadNameUpdatedNotification,
  ThreadStartedNotification,
  ThreadStatusChangedNotification,
  ThreadUnsubscribeResult,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  Turn,
  TurnCompletedNotification,
  TurnStartedNotification,
} from "./types.js";

const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_COMMAND_SHELL = process.env.SHELL ?? "/bin/sh";

interface TransportLike {
  send(message: JsonRpcMessage): void;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  onMessage(handler: (message: JsonRpcMessage) => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  onStderr?(handler: (line: string) => void): () => void;
  close(): Promise<void>;
}

interface CodexClientInternalOptions extends CodexClientOptions {
  transportFactory?: (cwd: string) => TransportLike;
}

const DEFAULT_OPTIONS: Required<CodexClientOptions> = {
  clientName: "openclaw",
  clientTitle: "OpenClaw",
  clientVersion: "0.1.0",
  model: "gpt-5.3-codex",
  cwd: process.cwd(),
  approvalPolicy: "never",
  sandbox: "workspace-write",
  experimentalApi: true,
  optOutNotificationMethods: [],
  codexPath: "codex",
};

export class CodexClient extends EventEmitter {
  private transport: TransportLike | null = null;
  private readonly options: Required<CodexClientOptions>;
  private readonly transportFactory: (cwd: string) => TransportLike;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;
  private unsubscribeStderr: (() => void) | null = null;
  private readonly completedTurns = new Map<string, Turn>();

  constructor(options: CodexClientInternalOptions = {}) {
    super();

    this.options = {
      clientName: options.clientName ?? DEFAULT_OPTIONS.clientName,
      clientTitle: options.clientTitle ?? options.clientName ?? DEFAULT_OPTIONS.clientTitle,
      clientVersion: options.clientVersion ?? DEFAULT_OPTIONS.clientVersion,
      model: options.model ?? DEFAULT_OPTIONS.model,
      cwd: options.cwd ?? DEFAULT_OPTIONS.cwd,
      approvalPolicy: options.approvalPolicy ?? DEFAULT_OPTIONS.approvalPolicy,
      sandbox: options.sandbox ?? DEFAULT_OPTIONS.sandbox,
      experimentalApi: options.experimentalApi ?? DEFAULT_OPTIONS.experimentalApi,
      optOutNotificationMethods:
        options.optOutNotificationMethods ?? DEFAULT_OPTIONS.optOutNotificationMethods,
      codexPath: options.codexPath ?? DEFAULT_OPTIONS.codexPath,
    };

    this.transportFactory =
      options.transportFactory ??
      ((cwd: string) => StdioTransport.spawn(cwd, this.options.codexPath));
  }

  async connect(): Promise<void> {
    if (this.transport) {
      return;
    }

    this.transport = this.transportFactory(this.options.cwd);

    this.unsubscribeMessage = this.transport.onMessage((message) => {
      this.handleMessage(message);
    });

    this.unsubscribeError = this.transport.onError((error) => {
      this.emit("error", error);
    });

    this.unsubscribeStderr = this.transport.onStderr?.((line) => {
      if (this.listenerCount("stderr") > 0) {
        this.emit("stderr", line);
        return;
      }

      console.error(line);
    }) ?? null;

    const initializeParams: InitializeParams = {
      clientInfo: {
        name: this.options.clientName,
        title: this.options.clientTitle,
        version: this.options.clientVersion,
      },
      capabilities: {
        experimentalApi: this.options.experimentalApi,
        ...(this.options.optOutNotificationMethods.length > 0
          ? { optOutNotificationMethods: this.options.optOutNotificationMethods }
          : {}),
      },
    };

    await this.request<InitializeResponse>("initialize", initializeParams, DEFAULT_TIMEOUT_MS);
    this.transport.send({ jsonrpc: "2.0", method: "initialized" });
  }

  async disconnect(): Promise<void> {
    if (!this.transport) {
      return;
    }

    const current = this.transport;
    this.transport = null;

    if (this.unsubscribeMessage) {
      this.unsubscribeMessage();
      this.unsubscribeMessage = null;
    }

    if (this.unsubscribeError) {
      this.unsubscribeError();
      this.unsubscribeError = null;
    }

    if (this.unsubscribeStderr) {
      this.unsubscribeStderr();
      this.unsubscribeStderr = null;
    }

    await current.close();
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const transport = this.ensureConnected();
    return (await transport.request(method, params, timeoutMs)) as T;
  }

  respondToServerRequest(requestId: RequestId, result: unknown): void {
    const transport = this.ensureConnected();
    transport.send({
      jsonrpc: "2.0",
      id: typeof requestId === "number" ? requestId : String(requestId),
      result,
    });
  }

  rejectServerRequest(requestId: RequestId, error: { code: number; message: string; data?: unknown }): void {
    const transport = this.ensureConnected();
    transport.send({
      jsonrpc: "2.0",
      id: typeof requestId === "number" ? requestId : String(requestId),
      error,
    });
  }

  respondToUserInputRequest(requestId: RequestId, response: ToolRequestUserInputResponse): void {
    this.respondToServerRequest(requestId, response);
  }

  async startThread(params: StartThreadParams = {}): Promise<Thread> {
    const result = await this.request("thread/start", {
      model: params.model ?? this.options.model,
      ...(params.modelProvider !== undefined ? { modelProvider: params.modelProvider } : {}),
      ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
      cwd: params.cwd ?? this.options.cwd,
      approvalPolicy: params.approvalPolicy ?? this.options.approvalPolicy,
      sandbox: params.sandbox ?? this.options.sandbox,
      ...(params.config !== undefined ? { config: params.config } : {}),
      ...(params.serviceName !== undefined ? { serviceName: params.serviceName } : {}),
      ...(params.baseInstructions !== undefined ? { baseInstructions: params.baseInstructions } : {}),
      ...(params.developerInstructions !== undefined
        ? { developerInstructions: params.developerInstructions }
        : {}),
      ...(params.personality !== undefined ? { personality: params.personality } : {}),
      ...(params.ephemeral !== undefined ? { ephemeral: params.ephemeral } : {}),
      experimentalRawEvents: params.experimentalRawEvents ?? false,
      persistExtendedHistory: params.persistExtendedHistory ?? false,
    });

    return extractThread(result);
  }

  async resumeThread(threadId: string, params: ResumeThreadParams = {}): Promise<Thread> {
    const result = await this.request("thread/resume", {
      threadId,
      ...(params.path !== undefined ? { path: params.path } : {}),
      ...(params.history !== undefined ? { history: params.history } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.modelProvider !== undefined ? { modelProvider: params.modelProvider } : {}),
      ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
      ...(params.approvalPolicy !== undefined ? { approvalPolicy: params.approvalPolicy } : {}),
      ...(params.sandbox !== undefined ? { sandbox: params.sandbox } : {}),
      ...(params.config !== undefined ? { config: params.config } : {}),
      ...(params.baseInstructions !== undefined ? { baseInstructions: params.baseInstructions } : {}),
      ...(params.developerInstructions !== undefined
        ? { developerInstructions: params.developerInstructions }
        : {}),
      ...(params.personality !== undefined ? { personality: params.personality } : {}),
      persistExtendedHistory: params.persistExtendedHistory ?? false,
    });

    return extractThread(result);
  }

  async forkThread(threadId: string, params: ForkThreadParams = {}): Promise<Thread> {
    const result = await this.request("thread/fork", {
      threadId,
      ...(params.path !== undefined ? { path: params.path } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.modelProvider !== undefined ? { modelProvider: params.modelProvider } : {}),
      ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
      ...(params.approvalPolicy !== undefined ? { approvalPolicy: params.approvalPolicy } : {}),
      ...(params.sandbox !== undefined ? { sandbox: params.sandbox } : {}),
      ...(params.config !== undefined ? { config: params.config } : {}),
      ...(params.baseInstructions !== undefined ? { baseInstructions: params.baseInstructions } : {}),
      ...(params.developerInstructions !== undefined
        ? { developerInstructions: params.developerInstructions }
        : {}),
      ...(params.ephemeral !== undefined ? { ephemeral: params.ephemeral } : {}),
      persistExtendedHistory: params.persistExtendedHistory ?? false,
    });

    return extractThread(result);
  }

  async readThread(threadId: string, includeTurns = false): Promise<Thread> {
    const result = await this.request("thread/read", {
      threadId,
      includeTurns,
    });

    return extractThread(result);
  }

  async listThreads(params: ListThreadsParams = {}): Promise<ThreadListResult> {
    const result = await this.request("thread/list", params);
    return extractThreadList(result);
  }

  async listLoadedThreads(params: ListLoadedThreadsParams = {}): Promise<ThreadLoadedListResult> {
    const result = await this.request("thread/loaded/list", params);
    return extractLoadedThreadList(result);
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request("thread/archive", { threadId });
  }

  async unarchiveThread(threadId: string): Promise<Thread> {
    const result = await this.request("thread/unarchive", { threadId });
    return extractThread(result);
  }

  async unsubscribeThread(threadId: string): Promise<ThreadUnsubscribeResult> {
    const result = await this.request("thread/unsubscribe", { threadId });
    return extractThreadUnsubscribeResult(result);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.request("thread/name/set", { threadId, name });
  }

  async compactThread(threadId: string): Promise<void> {
    await this.request("thread/compact/start", { threadId });
  }

  async rollbackThread(threadId: string, numTurns: number): Promise<Thread> {
    const result = await this.request("thread/rollback", { threadId, numTurns });
    return extractThread(result);
  }

  async startTurn(params: StartTurnParams): Promise<Turn> {
    const result = await this.request("turn/start", params, TURN_TIMEOUT_MS);
    return extractTurn(result);
  }

  async steerTurn(params: SteerTurnParams): Promise<string> {
    const result = await this.request("turn/steer", params, TURN_TIMEOUT_MS);

    if (isObject(result) && typeof result.turnId === "string") {
      return result.turnId;
    }

    if (isObject(result) && isTurn(result.turn) && typeof result.turn.id === "string") {
      return result.turn.id;
    }

    throw new Error("Missing turnId in turn/steer result");
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId }, DEFAULT_TIMEOUT_MS);
  }

  async startReview(params: StartReviewParams): Promise<ReviewResult> {
    const result = await this.request("review/start", params, TURN_TIMEOUT_MS);

    if (!isObject(result)) {
      return {};
    }

    return {
      ...(isTurn(result.turn) ? { turn: result.turn } : {}),
      ...(typeof result.reviewThreadId === "string"
        ? { reviewThreadId: result.reviewThreadId }
        : {}),
    };
  }

  async listModels(params: ListModelsParams = {}): Promise<ModelListResult> {
    const result = await this.request("model/list", params);
    return extractModelList(result);
  }

  async listExperimentalFeatures(
    params: ExperimentalFeatureListParams = {},
  ): Promise<ExperimentalFeatureListResult> {
    const result = await this.request("experimentalFeature/list", params);
    return extractExperimentalFeatureList(result);
  }

  async listCollaborationModes(): Promise<CollaborationModeListResult> {
    const result = await this.request("collaborationMode/list", {});
    return extractCollaborationModeList(result);
  }

  async listSkills(params: SkillsListParams = {}): Promise<SkillsListResult> {
    const result = await this.request("skills/list", params);
    return extractSkillsList(result);
  }

  async listApps(params: AppListParams = {}): Promise<AppListResult> {
    const result = await this.request("app/list", params);
    return extractAppList(result);
  }

  async readConfig(params: ConfigReadParams = {}): Promise<ConfigReadResult> {
    const result = await this.request("config/read", {
      includeLayers: params.includeLayers ?? false,
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
    });

    return extractConfigReadResult(result);
  }

  async writeConfigValue(params: ConfigValueWriteParams): Promise<ConfigWriteResult> {
    const result = await this.request("config/value/write", params);
    return extractConfigWriteResult(result);
  }

  async batchWriteConfig(params: ConfigBatchWriteParams): Promise<ConfigWriteResult> {
    const result = await this.request("config/batchWrite", params);
    return extractConfigWriteResult(result);
  }

  async readConfigRequirements(): Promise<ConfigRequirementsReadResult> {
    const result = await this.request("configRequirements/read", {});
    return extractConfigRequirementsReadResult(result);
  }

  async execCommand(params: ExecCommandParams): Promise<ExecCommandResult> {
    const result = await this.request(
      "command/exec",
      {
        ...params,
        command: normalizeExecCommand(params.command),
      },
      TURN_TIMEOUT_MS,
    );
    return extractExecCommandResult(result);
  }

  async writeExecCommand(params: CommandExecWriteParams): Promise<void> {
    await this.request("command/exec/write", params, DEFAULT_TIMEOUT_MS);
  }

  async resizeExecCommand(params: CommandExecResizeParams): Promise<void> {
    await this.request("command/exec/resize", params, DEFAULT_TIMEOUT_MS);
  }

  async terminateExecCommand(params: CommandExecTerminateParams): Promise<void> {
    await this.request("command/exec/terminate", params, DEFAULT_TIMEOUT_MS);
  }

  async runTurn(params: StartTurnParams): Promise<CompletedTurn> {
    const itemsByTurn = new Map<string, ThreadItem[]>();
    const diffByTurn = new Map<string, string>();
    const agentMessagesByTurn = new Map<string, Map<string, string>>();

    const onItemCompleted = (payload: ItemNotification): void => {
      const items = itemsByTurn.get(payload.turnId) ?? [];
      items.push(payload.item);
      itemsByTurn.set(payload.turnId, items);

      if (payload.item.type === "agentMessage") {
        const byItem = agentMessagesByTurn.get(payload.turnId) ?? new Map<string, string>();
        const current = byItem.get(payload.item.id) ?? "";
        const text = typeof payload.item.text === "string" ? payload.item.text : "";
        byItem.set(payload.item.id, `${current}${text}`);
        agentMessagesByTurn.set(payload.turnId, byItem);
      }
    };

    const onAgentDelta = (payload: AgentMessageDeltaNotification): void => {
      const byItem = agentMessagesByTurn.get(payload.turnId) ?? new Map<string, string>();
      const current = byItem.get(payload.itemId) ?? "";
      byItem.set(payload.itemId, `${current}${payload.delta}`);
      agentMessagesByTurn.set(payload.turnId, byItem);
    };

    const onDiff = (payload: DiffUpdatedNotification): void => {
      diffByTurn.set(payload.turnId, payload.diff);
    };

    this.on("_internal:itemCompleted", onItemCompleted);
    this.on("_internal:agentDelta", onAgentDelta);
    this.on("_internal:turnDiff", onDiff);

    try {
      const turn = await this.startTurn(params);
      const completedTurn = await this.waitForTurnCompletion(turn.id, TURN_TIMEOUT_MS);

      if (completedTurn.status === "failed") {
        const message = completedTurn.error?.message ?? "Turn failed";
        throw new Error(message);
      }

      const items = itemsByTurn.get(turn.id) ?? [];
      const agentMessage = this.extractAgentMessage(
        items,
        agentMessagesByTurn.get(turn.id) ?? new Map<string, string>(),
      );

      const diff = diffByTurn.get(turn.id);
      return {
        turn: completedTurn,
        items,
        agentMessage,
        ...(diff !== undefined ? { diff } : {}),
      };
    } finally {
      this.off("_internal:itemCompleted", onItemCompleted);
      this.off("_internal:agentDelta", onAgentDelta);
      this.off("_internal:turnDiff", onDiff);
    }
  }

  async runReview(params: StartReviewParams): Promise<CompletedReview> {
    const result = await this.startReview(params);
    const reviewTurnId = result.turn?.id;
    const reviewTexts: string[] = [];
    const agentMessagesByTurn = new Map<string, Map<string, string>>();

    const onItemCompleted = (payload: ItemNotification): void => {
      if (reviewTurnId && payload.turnId !== reviewTurnId) {
        return;
      }

      if (payload.item.type === "agentMessage") {
        const byItem = agentMessagesByTurn.get(payload.turnId) ?? new Map<string, string>();
        const current = byItem.get(payload.item.id) ?? "";
        byItem.set(payload.item.id, `${current}${payload.item.text}`);
        agentMessagesByTurn.set(payload.turnId, byItem);
      }

      if (
        payload.item.type === "enteredReviewMode" ||
        payload.item.type === "exitedReviewMode"
      ) {
        const review = payload.item.review;
        if (typeof review === "string" && review.length > 0) {
          reviewTexts.push(review);
        }
      }
    };

    const onAgentDelta = (payload: AgentMessageDeltaNotification): void => {
      if (reviewTurnId && payload.turnId !== reviewTurnId) {
        return;
      }

      const byItem = agentMessagesByTurn.get(payload.turnId) ?? new Map<string, string>();
      const current = byItem.get(payload.itemId) ?? "";
      byItem.set(payload.itemId, `${current}${payload.delta}`);
      agentMessagesByTurn.set(payload.turnId, byItem);
    };

    this.on("_internal:itemCompleted", onItemCompleted);
    this.on("_internal:agentDelta", onAgentDelta);

    try {
      const turn = reviewTurnId
        ? await this.waitForTurnCompletion(reviewTurnId, TURN_TIMEOUT_MS)
        : await this.waitForAnyThreadTurnCompletion(params.threadId, TURN_TIMEOUT_MS);

      const reviewText = reviewTexts.join("\n").trim();
      if (reviewText.length > 0) {
        return { turn, reviewText };
      }

      const byItem = agentMessagesByTurn.get(turn.id) ?? new Map<string, string>();
      const fallback = [...byItem.values()].join("").trim();
      return {
        turn,
        reviewText: fallback,
      };
    } finally {
      this.off("_internal:itemCompleted", onItemCompleted);
      this.off("_internal:agentDelta", onAgentDelta);
    }
  }

  private ensureConnected(): TransportLike {
    if (!this.transport) {
      throw new Error("Client is not connected. Call connect() first.");
    }

    return this.transport;
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (isJsonRpcRequest(message)) {
      this.handleServerRequest(message);
      return;
    }

    if (!isJsonRpcNotification(message)) {
      return;
    }

    const { method, params } = message;

    switch (method) {
      case "turn/started": {
        const data = asTurnNotification(params);
        if (!data) return;
        this.emit("turn:started", data.turn);
        break;
      }
      case "turn/completed": {
        const data = asTurnCompletedNotification(params);
        if (!data) return;
        this.completedTurns.set(data.turn.id, data.turn);
        this.emit("turn:completed", data.turn);
        this.emit("_internal:turnCompleted", data);
        break;
      }
      case "item/started": {
        const data = asItemNotification(params);
        if (!data) return;
        this.emit("item:started", data.item);
        break;
      }
      case "item/completed": {
        const data = asItemNotification(params);
        if (!data) return;
        this.emit("item:completed", data.item);
        this.emit("_internal:itemCompleted", data);
        break;
      }
      case "item/agentMessage/delta": {
        const data = asAgentDeltaNotification(params);
        if (!data) return;
        this.emit("item:agentMessage:delta", {
          itemId: data.itemId,
          delta: data.delta,
        });
        this.emit("_internal:agentDelta", data);
        break;
      }
      case "item/commandExecution/outputDelta": {
        const data = asCommandOutputDeltaNotification(params);
        if (!data) return;
        this.emit("item:commandExecution:outputDelta", {
          itemId: data.itemId,
          delta: data.delta,
        });
        break;
      }
      case "command/exec/outputDelta": {
        const data = asCommandExecOutputDeltaNotification(params);
        if (!data) return;
        this.emit("command:exec:outputDelta", data);
        break;
      }
      case "turn/diff/updated": {
        const data = asDiffUpdatedNotification(params);
        if (!data) return;
        this.emit("turn:diff:updated", data);
        this.emit("_internal:turnDiff", data);
        break;
      }
      case "turn/plan/updated": {
        const data = asPlanUpdatedNotification(params);
        if (!data) return;
        this.emit("turn:plan:updated", data);
        break;
      }
      case "turn/plan/delta": {
        const data = asPlanDeltaNotification(params);
        if (!data) return;
        this.emit("turn:plan:delta", data);
        break;
      }
      case "thread/started": {
        const data = asThreadStartedNotification(params);
        if (!data) return;
        this.emit("thread:started", data.thread);
        break;
      }
      case "thread/status/changed": {
        const data = asThreadStatusChangedNotification(params);
        if (!data) return;
        this.emit("thread:status:changed", data);
        break;
      }
      case "thread/archived": {
        const data = asThreadLifecycleNotification(params);
        if (!data) return;
        this.emit("thread:archived", data);
        break;
      }
      case "thread/unarchived": {
        const data = asThreadLifecycleNotification(params);
        if (!data) return;
        this.emit("thread:unarchived", data);
        break;
      }
      case "thread/closed": {
        const data = asThreadLifecycleNotification(params);
        if (!data) return;
        this.emit("thread:closed", data);
        break;
      }
      case "thread/name/updated": {
        const data = asThreadNameUpdatedNotification(params);
        if (!data) return;
        this.emit("thread:name:updated", data);
        break;
      }
      case "app/list/updated": {
        const data = asAppListUpdatedNotification(params);
        if (!data) return;
        this.emit("app:list:updated", data);
        break;
      }
      case "serverRequest/resolved": {
        const data = asServerRequestResolvedNotification(params);
        if (!data) return;
        this.emit("serverRequest:resolved", data);
        break;
      }
      case "skills/changed": {
        this.emit("skills:changed");
        break;
      }
      default:
        break;
    }
  }

  private handleServerRequest(message: JsonRpcRequest): void {
    switch (message.method) {
      case "item/tool/requestUserInput":
      case "tool/requestUserInput": {
        const data = asToolRequestUserInputParams(message.params);
        if (!data) {
          return;
        }

        this.emit("request:userInput", {
          requestId: message.id,
          ...data,
        });
        break;
      }
      default:
        this.emit("server:request", message);
        break;
    }
  }

  private waitForTurnCompletion(turnId: string, timeoutMs: number): Promise<Turn> {
    const alreadyCompleted = this.completedTurns.get(turnId);
    if (alreadyCompleted) {
      this.completedTurns.delete(turnId);
      return Promise.resolve(alreadyCompleted);
    }

    return new Promise<Turn>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off("_internal:turnCompleted", onTurnCompleted);
        reject(new Error(`Timed out waiting for turn completion: ${turnId}`));
      }, timeoutMs);

      const onTurnCompleted = (notification: TurnCompletedNotification): void => {
        if (notification.turn.id !== turnId) {
          return;
        }

        clearTimeout(timeout);
        this.off("_internal:turnCompleted", onTurnCompleted);
        this.completedTurns.delete(turnId);
        resolve(notification.turn);
      };

      this.on("_internal:turnCompleted", onTurnCompleted);
    });
  }

  private waitForAnyThreadTurnCompletion(threadId: string, timeoutMs: number): Promise<Turn> {
    return new Promise<Turn>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off("_internal:turnCompleted", onTurnCompleted);
        reject(new Error(`Timed out waiting for turn completion on thread ${threadId}`));
      }, timeoutMs);

      const onTurnCompleted = (notification: TurnCompletedNotification): void => {
        if (notification.threadId !== threadId) {
          return;
        }

        clearTimeout(timeout);
        this.off("_internal:turnCompleted", onTurnCompleted);
        resolve(notification.turn);
      };

      this.on("_internal:turnCompleted", onTurnCompleted);
    });
  }

  private extractAgentMessage(items: ThreadItem[], deltas: Map<string, string>): string {
    let lastAgentMessage = "";

    for (const item of items) {
      if (item.type === "agentMessage" && typeof item.text === "string" && item.text.length > 0) {
        lastAgentMessage = item.text;
      }
    }

    if (lastAgentMessage.length > 0) {
      return lastAgentMessage;
    }

    if (deltas.size > 0) {
      return [...deltas.values()].join("");
    }

    return "";
  }
}

function normalizeExecCommand(command: string | string[]): string[] {
  if (Array.isArray(command)) {
    return command;
  }

  return [DEFAULT_COMMAND_SHELL, "-lc", command];
}

function extractThread(result: unknown): Thread {
  if (isThread(result)) {
    return result;
  }

  if (isObject(result) && isThread(result.thread)) {
    return result.thread;
  }

  throw new Error("Invalid thread response");
}

function extractTurn(result: unknown): Turn {
  if (isTurn(result)) {
    return result;
  }

  if (isObject(result) && isTurn(result.turn)) {
    return result.turn;
  }

  throw new Error("Invalid turn response");
}

function extractThreadList(result: unknown): ThreadListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isThread),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null
        ? { nextCursor: result.nextCursor }
        : {}),
    };
  }

  throw new Error("Invalid thread list response");
}

function extractLoadedThreadList(result: unknown): ThreadLoadedListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter((entry): entry is string => typeof entry === "string"),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null
        ? { nextCursor: result.nextCursor }
        : {}),
    };
  }

  throw new Error("Invalid loaded thread list response");
}

function extractModelList(result: unknown): ModelListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isModelInfo),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null
        ? { nextCursor: result.nextCursor }
        : {}),
    };
  }

  throw new Error("Invalid model list response");
}

function extractExperimentalFeatureList(result: unknown): ExperimentalFeatureListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isExperimentalFeature),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null
        ? { nextCursor: result.nextCursor }
        : {}),
    };
  }

  throw new Error("Invalid experimental feature list response");
}

function extractCollaborationModeList(result: unknown): CollaborationModeListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isCollaborationModeMask),
    };
  }

  throw new Error("Invalid collaboration mode list response");
}

function extractSkillsList(result: unknown): SkillsListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isSkillsListEntry),
    };
  }

  throw new Error("Invalid skills list response");
}

function extractAppList(result: unknown): AppListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isAppInfo),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null
        ? { nextCursor: result.nextCursor }
        : {}),
    };
  }

  throw new Error("Invalid app list response");
}

function extractConfigReadResult(result: unknown): ConfigReadResult {
  if (isObject(result) && isObject(result.config) && isObject(result.origins)) {
    return {
      config: result.config,
      origins: result.origins as ConfigReadResult["origins"],
      layers: Array.isArray(result.layers) || result.layers === null ? result.layers : null,
    };
  }

  throw new Error("Invalid config read response");
}

function extractConfigWriteResult(result: unknown): ConfigWriteResult {
  if (
    isObject(result) &&
    typeof result.status === "string" &&
    typeof result.version === "string" &&
    typeof result.filePath === "string"
  ) {
    return {
      status: result.status as ConfigWriteResult["status"],
      version: result.version,
      filePath: result.filePath,
      ...(isObject(result.overriddenMetadata) || result.overriddenMetadata === null
        ? { overriddenMetadata: result.overriddenMetadata as ConfigWriteResult["overriddenMetadata"] }
        : {}),
    };
  }

  throw new Error("Invalid config write response");
}

function extractConfigRequirementsReadResult(result: unknown): ConfigRequirementsReadResult {
  if (isObject(result) && ("requirements" in result)) {
    return {
      requirements: isObject(result.requirements) || result.requirements === null
        ? (result.requirements as ConfigRequirementsReadResult["requirements"])
        : null,
    };
  }

  throw new Error("Invalid config requirements response");
}

function extractExecCommandResult(result: unknown): ExecCommandResult {
  if (
    isObject(result) &&
    typeof result.exitCode === "number" &&
    typeof result.stdout === "string" &&
    typeof result.stderr === "string"
  ) {
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  throw new Error("Invalid command execution response");
}

function extractThreadUnsubscribeResult(result: unknown): ThreadUnsubscribeResult {
  if (isObject(result) && typeof result.status === "string") {
    return { status: result.status as ThreadUnsubscribeResult["status"] };
  }

  throw new Error("Invalid thread unsubscribe response");
}

function asTurnNotification(params: unknown): TurnStartedNotification | null {
  if (isObject(params) && typeof params.threadId === "string" && isTurn(params.turn)) {
    return { threadId: params.threadId, turn: params.turn };
  }

  return null;
}

function asTurnCompletedNotification(params: unknown): TurnCompletedNotification | null {
  if (isObject(params) && typeof params.threadId === "string" && isTurn(params.turn)) {
    return { threadId: params.threadId, turn: params.turn };
  }

  return null;
}

function asItemNotification(params: unknown): ItemNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    isThreadItem(params.item)
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      item: params.item,
    };
  }

  return null;
}

function asAgentDeltaNotification(params: unknown): AgentMessageDeltaNotification | null {
  const delta = getString(params, "delta") ?? getString(params, "text");
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.itemId === "string" &&
    delta !== undefined
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      delta,
    };
  }

  return null;
}

function asCommandOutputDeltaNotification(params: unknown): CommandOutputDeltaNotification | null {
  const delta = getString(params, "delta") ?? getString(params, "output");
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.itemId === "string" &&
    delta !== undefined
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      delta,
    };
  }

  return null;
}

function asCommandExecOutputDeltaNotification(
  params: unknown,
): CommandExecOutputDeltaNotification | null {
  if (
    isObject(params) &&
    typeof params.processId === "string" &&
    typeof params.stream === "string" &&
    typeof params.deltaBase64 === "string" &&
    typeof params.capReached === "boolean"
  ) {
    return {
      processId: params.processId,
      stream: params.stream as CommandExecOutputDeltaNotification["stream"],
      deltaBase64: params.deltaBase64,
      capReached: params.capReached,
    };
  }

  return null;
}

function asDiffUpdatedNotification(params: unknown): DiffUpdatedNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.diff === "string"
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      diff: params.diff,
    };
  }

  return null;
}

function asPlanUpdatedNotification(params: unknown): PlanUpdatedNotification | null {
  if (isObject(params) && typeof params.turnId === "string" && Array.isArray(params.plan)) {
    return {
      ...(typeof params.threadId === "string" ? { threadId: params.threadId } : {}),
      turnId: params.turnId,
      ...(typeof params.explanation === "string" || params.explanation === null
        ? { explanation: params.explanation }
        : {}),
      plan: params.plan as PlanUpdatedNotification["plan"],
    };
  }

  return null;
}

function asPlanDeltaNotification(params: unknown): PlanDeltaNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.itemId === "string" &&
    typeof params.delta === "string"
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      delta: params.delta,
    };
  }

  return null;
}

function asThreadStartedNotification(params: unknown): ThreadStartedNotification | null {
  if (isObject(params) && isThread(params.thread)) {
    return { thread: params.thread };
  }

  return null;
}

function asThreadStatusChangedNotification(params: unknown): ThreadStatusChangedNotification | null {
  if (isObject(params) && typeof params.threadId === "string" && typeof params.status === "string") {
    return {
      threadId: params.threadId,
      status: params.status,
    };
  }

  return null;
}

function asThreadLifecycleNotification(params: unknown): ThreadLifecycleNotification | null {
  if (isObject(params) && typeof params.threadId === "string") {
    return { threadId: params.threadId };
  }

  return null;
}

function asThreadNameUpdatedNotification(params: unknown): ThreadNameUpdatedNotification | null {
  if (isObject(params) && typeof params.threadId === "string") {
    return {
      threadId: params.threadId,
      ...(typeof params.threadName === "string" ? { threadName: params.threadName } : {}),
    };
  }

  return null;
}

function asAppListUpdatedNotification(params: unknown): AppListUpdatedNotification | null {
  if (isObject(params) && Array.isArray(params.data)) {
    return {
      data: params.data.filter(isAppInfo),
    };
  }

  return null;
}

function asToolRequestUserInputParams(params: unknown): ToolRequestUserInputParams | null {
  if (
    isObject(params) &&
    typeof params.itemId === "string" &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    Array.isArray(params.questions)
  ) {
    const questions = params.questions
      .map((question) => asToolRequestUserInputQuestion(question))
      .filter((question): question is NonNullable<typeof question> => question !== null);

    return {
      itemId: params.itemId,
      threadId: params.threadId,
      turnId: params.turnId,
      questions,
    };
  }

  return null;
}

function asToolRequestUserInputQuestion(params: unknown) {
  if (
    isObject(params) &&
    typeof params.header === "string" &&
    typeof params.id === "string" &&
    typeof params.question === "string"
  ) {
    return {
      header: params.header,
      id: params.id,
      question: params.question,
      ...(typeof params.isOther === "boolean" ? { isOther: params.isOther } : {}),
      ...(typeof params.isSecret === "boolean" ? { isSecret: params.isSecret } : {}),
      ...(Array.isArray(params.options)
        ? {
            options: params.options
              .map((option) => asToolRequestUserInputOption(option))
              .filter((option): option is NonNullable<typeof option> => option !== null),
          }
        : params.options === null
          ? { options: null }
          : {}),
    };
  }

  return null;
}

function asToolRequestUserInputOption(params: unknown) {
  if (isObject(params) && typeof params.label === "string" && typeof params.description === "string") {
    return {
      label: params.label,
      description: params.description,
    };
  }

  return null;
}

function asServerRequestResolvedNotification(params: unknown): ServerRequestResolvedNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    (typeof params.requestId === "string" || typeof params.requestId === "number")
  ) {
    return {
      threadId: params.threadId,
      requestId: params.requestId,
    };
  }

  return null;
}

function getString(value: unknown, key: string): string | undefined {
  if (isObject(value) && typeof value[key] === "string") {
    return value[key] as string;
  }

  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThread(value: unknown): value is Thread {
  return isObject(value) && typeof value.id === "string";
}

function isTurn(value: unknown): value is Turn {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.items)
  );
}

function isThreadItem(value: unknown): value is ThreadItem {
  return isObject(value) && typeof value.id === "string" && typeof value.type === "string";
}

function isModelInfo(value: unknown): value is ModelInfo {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.model === "string" &&
    typeof value.displayName === "string"
  );
}

function isExperimentalFeature(value: unknown): value is ExperimentalFeatureListResult["data"][number] {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    typeof value.stage === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.defaultEnabled === "boolean"
  );
}

function isCollaborationModeMask(value: unknown): value is CollaborationModeListResult["data"][number] {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    ("mode" in value)
  );
}

function isSkillsListEntry(value: unknown): value is SkillsListResult["data"][number] {
  return (
    isObject(value) &&
    typeof value.cwd === "string" &&
    Array.isArray(value.skills) &&
    Array.isArray(value.errors)
  );
}

function isAppInfo(value: unknown): value is AppInfo {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.isAccessible === "boolean" &&
    typeof value.isEnabled === "boolean" &&
    Array.isArray(value.pluginDisplayNames)
  );
}
