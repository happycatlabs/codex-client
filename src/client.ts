import { SimpleEventEmitter } from "./emitter.js";
import { StdioTransport, isJsonRpcNotification, isJsonRpcRequest, type TransportLike } from "./transport.js";
import type {
  AgentMessageDeltaNotification,
  AppInfo,
  AppListParams,
  AppListResult,
  AppListUpdatedNotification,
  CodexClientEventMap,
  CodexClientOptions,
  CodexProcessInfo,
  CodexClientRequestMap,
  CodexClientRequestParams,
  CodexClientRequestResult,
  CollaborationModeListResult,
  CommandExecOutputDeltaNotification,
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
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
  DeprecationNoticeNotification,
  DiffUpdatedNotification,
  ErrorNotification,
  ExecCommandParams,
  ExecCommandResult,
  ExperimentalFeatureListParams,
  ExperimentalFeatureListResult,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
  ForkThreadParams,
  InitializeParams,
  InitializeResponse,
  ItemNotification,
  JsonRpcMessage,
  JsonRpcRequest,
  ListLoadedThreadsParams,
  ListModelsParams,
  ListThreadsParams,
  McpToolCallProgressNotification,
  ModelInfo,
  ModelListResult,
  ModelReroutedNotification,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  PlanDeltaNotification,
  PlanUpdatedNotification,
  RawResponseItemCompletedNotification,
  RequestId,
  ResponseItem,
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
  ThreadCompactedNotification,
  ThreadItem,
  ThreadItemEntry,
  ThreadItemsListEntry,
  ThreadItemsListParams,
  ThreadItemsListResult,
  ThreadLifecycleNotification,
  ThreadListResult,
  ThreadLoadedListResult,
  ThreadNameUpdatedNotification,
  ThreadStartedNotification,
  ThreadStatusChangedNotification,
  ThreadTokenUsage,
  ThreadTokenUsageUpdatedNotification,
  ThreadTurnsItemsListParams,
  ThreadTurnsItemsListResult,
  ThreadTurnsListParams,
  ThreadTurnsListResult,
  ThreadUnsubscribeResult,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  Turn,
  TurnCompletedNotification,
  TurnError,
  TurnStartedNotification,
  WarningNotification,
} from "./types.js";

const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 1000;

interface CodexClientInternalOptions extends CodexClientOptions {
  transportFactory?: (cwd: string) => TransportLike;
}

/**
 * `model`, `requestAttestation`, and `mcpServerOpenaiFormElicitation` have no
 * client-side default: when unset they are omitted from the wire payloads so
 * the server applies its own defaults (e.g. the user's configured model).
 */
type ResolvedCodexClientOptions = Required<
  Omit<CodexClientOptions, "model" | "requestAttestation" | "mcpServerOpenaiFormElicitation">
> &
  Pick<CodexClientOptions, "model" | "requestAttestation" | "mcpServerOpenaiFormElicitation">;

const DEFAULT_OPTIONS: ResolvedCodexClientOptions = {
  clientName: "openclaw",
  clientTitle: "OpenClaw",
  clientVersion: "0.1.0",
  cwd: getDefaultCwd(),
  approvalPolicy: "never",
  sandbox: "workspace-write",
  experimentalApi: true,
  optOutNotificationMethods: [],
  codexPath: "codex",
  detached: false,
  spawnArgs: [],
};

export class CodexClient extends SimpleEventEmitter<CodexClientEventMap> {
  private transport: TransportLike | null = null;
  private readonly options: ResolvedCodexClientOptions;
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
      ...(options.model !== undefined ? { model: options.model } : {}),
      cwd: options.cwd ?? DEFAULT_OPTIONS.cwd,
      approvalPolicy: options.approvalPolicy ?? DEFAULT_OPTIONS.approvalPolicy,
      sandbox: options.sandbox ?? DEFAULT_OPTIONS.sandbox,
      experimentalApi: options.experimentalApi ?? DEFAULT_OPTIONS.experimentalApi,
      ...(options.requestAttestation !== undefined ? { requestAttestation: options.requestAttestation } : {}),
      ...(options.mcpServerOpenaiFormElicitation !== undefined
        ? { mcpServerOpenaiFormElicitation: options.mcpServerOpenaiFormElicitation }
        : {}),
      optOutNotificationMethods: options.optOutNotificationMethods ?? DEFAULT_OPTIONS.optOutNotificationMethods,
      codexPath: options.codexPath ?? DEFAULT_OPTIONS.codexPath,
      detached: options.detached ?? DEFAULT_OPTIONS.detached,
      spawnArgs: options.spawnArgs ?? DEFAULT_OPTIONS.spawnArgs,
    };

    this.transportFactory =
      options.transportFactory ??
      ((cwd: string) =>
        StdioTransport.spawn(cwd, this.options.codexPath, this.options.spawnArgs, {
          detached: this.options.detached,
        }));
  }

  /** Spawned app-server identity while connected; absent for remote/custom transports. */
  get processInfo(): CodexProcessInfo | undefined {
    return this.transport?.processInfo;
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

    this.unsubscribeStderr =
      this.transport.onStderr?.((line) => {
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
        ...(this.options.requestAttestation !== undefined
          ? { requestAttestation: this.options.requestAttestation }
          : {}),
        ...(this.options.mcpServerOpenaiFormElicitation !== undefined
          ? { mcpServerOpenaiFormElicitation: this.options.mcpServerOpenaiFormElicitation }
          : {}),
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

  async request<Method extends keyof CodexClientRequestMap>(
    method: Method,
    params: CodexClientRequestParams<Method>,
    timeoutMs?: number,
  ): Promise<CodexClientRequestResult<Method>>;
  async request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  async request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
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

  respondToCommandExecutionApproval(requestId: RequestId, decision: CommandExecutionApprovalDecision): void {
    this.respondToServerRequest(requestId, { decision });
  }

  respondToFileChangeApproval(requestId: RequestId, decision: FileChangeApprovalDecision): void {
    this.respondToServerRequest(requestId, { decision });
  }

  respondToPermissionsApproval(requestId: RequestId, response: PermissionsRequestApprovalResponse): void {
    this.respondToServerRequest(requestId, response);
  }

  async startThread(params: StartThreadParams = {}): Promise<Thread> {
    const model = params.model ?? this.options.model;
    const result = await this.request("thread/start", {
      ...(model !== undefined ? { model } : {}),
      ...(params.modelProvider !== undefined ? { modelProvider: params.modelProvider } : {}),
      ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
      cwd: params.cwd ?? this.options.cwd,
      approvalPolicy: params.approvalPolicy ?? this.options.approvalPolicy,
      ...(params.approvalsReviewer !== undefined ? { approvalsReviewer: params.approvalsReviewer } : {}),
      sandbox: params.sandbox ?? this.options.sandbox,
      ...(params.config !== undefined ? { config: params.config } : {}),
      ...(params.serviceName !== undefined ? { serviceName: params.serviceName } : {}),
      ...(params.baseInstructions !== undefined ? { baseInstructions: params.baseInstructions } : {}),
      ...(params.developerInstructions !== undefined ? { developerInstructions: params.developerInstructions } : {}),
      ...(params.personality !== undefined ? { personality: params.personality } : {}),
      ...(params.ephemeral !== undefined ? { ephemeral: params.ephemeral } : {}),
      ...(params.sessionStartSource !== undefined ? { sessionStartSource: params.sessionStartSource } : {}),
      ...(params.threadSource !== undefined ? { threadSource: params.threadSource } : {}),
      ...(params.experimentalRawEvents !== undefined ? { experimentalRawEvents: params.experimentalRawEvents } : {}),
    });

    return extractThread(result);
  }

  async resumeThread(threadId: string, params: ResumeThreadParams = {}): Promise<Thread> {
    const result = await this.request("thread/resume", {
      threadId,
      ...(params.history !== undefined ? { history: params.history } : {}),
      ...(params.path !== undefined ? { path: params.path } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.modelProvider !== undefined ? { modelProvider: params.modelProvider } : {}),
      ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
      ...(params.approvalPolicy !== undefined ? { approvalPolicy: params.approvalPolicy } : {}),
      ...(params.approvalsReviewer !== undefined ? { approvalsReviewer: params.approvalsReviewer } : {}),
      ...(params.sandbox !== undefined ? { sandbox: params.sandbox } : {}),
      ...(params.config !== undefined ? { config: params.config } : {}),
      ...(params.baseInstructions !== undefined ? { baseInstructions: params.baseInstructions } : {}),
      ...(params.developerInstructions !== undefined ? { developerInstructions: params.developerInstructions } : {}),
      ...(params.personality !== undefined ? { personality: params.personality } : {}),
      ...(params.excludeTurns !== undefined ? { excludeTurns: params.excludeTurns } : {}),
      ...(params.initialTurnsPage !== undefined ? { initialTurnsPage: params.initialTurnsPage } : {}),
    });

    return extractThread(result);
  }

  async forkThread(threadId: string, params: ForkThreadParams = {}): Promise<Thread> {
    const result = await this.request("thread/fork", {
      threadId,
      ...(params.lastTurnId !== undefined ? { lastTurnId: params.lastTurnId } : {}),
      ...(params.path !== undefined ? { path: params.path } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
      ...(params.modelProvider !== undefined ? { modelProvider: params.modelProvider } : {}),
      ...(params.serviceTier !== undefined ? { serviceTier: params.serviceTier } : {}),
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
      ...(params.approvalPolicy !== undefined ? { approvalPolicy: params.approvalPolicy } : {}),
      ...(params.approvalsReviewer !== undefined ? { approvalsReviewer: params.approvalsReviewer } : {}),
      ...(params.sandbox !== undefined ? { sandbox: params.sandbox } : {}),
      ...(params.config !== undefined ? { config: params.config } : {}),
      ...(params.baseInstructions !== undefined ? { baseInstructions: params.baseInstructions } : {}),
      ...(params.developerInstructions !== undefined ? { developerInstructions: params.developerInstructions } : {}),
      ...(params.ephemeral !== undefined ? { ephemeral: params.ephemeral } : {}),
      ...(params.threadSource !== undefined ? { threadSource: params.threadSource } : {}),
      ...(params.excludeTurns !== undefined ? { excludeTurns: params.excludeTurns } : {}),
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

  /** Experimental stored-turn pagination. */
  async listThreadTurns(params: ThreadTurnsListParams): Promise<ThreadTurnsListResult> {
    const result = await this.request("thread/turns/list", params);
    return extractThreadTurnsList(result);
  }

  /** Experimental persisted-item pagination, optionally scoped to one turn. */
  async listThreadItems(params: ThreadItemsListParams): Promise<ThreadItemsListResult> {
    const result = await this.request("thread/items/list", params);
    return extractThreadItemsList(result);
  }

  /** @deprecated Use `listThreadItems()`; this alias keeps the former one-turn helper name. */
  async listThreadTurnItems(params: ThreadTurnsItemsListParams): Promise<ThreadTurnsItemsListResult> {
    const result = await this.listThreadItems(params);
    return {
      ...result,
      data: result.data.map((entry) => (isThreadItemEntry(entry) ? entry.item : entry)),
    };
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request("thread/archive", { threadId });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.request("thread/delete", { threadId });
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

  /**
   * @deprecated `thread/rollback` is deprecated upstream and will be removed
   * from the app-server protocol. Prefer `forkThread(threadId, { lastTurnId })`
   * to branch a thread at an earlier turn.
   */
  async rollbackThread(threadId: string, numTurns: number): Promise<Thread> {
    const result = await this.request("thread/rollback", { threadId, numTurns });
    return extractThread(result);
  }

  async startTurn(params: StartTurnParams): Promise<Turn> {
    const result = await this.request("turn/start", params, TURN_TIMEOUT_MS);
    return extractTurn(result);
  }

  async steerTurn(params: SteerTurnParams): Promise<string> {
    const result = await this.request<unknown>("turn/steer", params, TURN_TIMEOUT_MS);

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
      ...(typeof result.reviewThreadId === "string" ? { reviewThreadId: result.reviewThreadId } : {}),
    };
  }

  async listModels(params: ListModelsParams = {}): Promise<ModelListResult> {
    const result = await this.request("model/list", params);
    return extractModelList(result);
  }

  async listExperimentalFeatures(params: ExperimentalFeatureListParams = {}): Promise<ExperimentalFeatureListResult> {
    const result = await this.request("experimentalFeature/list", params);
    return extractExperimentalFeatureList(result);
  }

  /** Experimental collaboration-mode presets. */
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
        const details = completedTurn.error?.additionalDetails;
        throw new Error(typeof details === "string" && details.length > 0 ? `${message}\n${details}` : message);
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

      if (payload.item.type === "enteredReviewMode" || payload.item.type === "exitedReviewMode") {
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

    this.emit("notification", message);

    const { method, params } = message;

    switch (method) {
      case "turn/started": {
        const data = asTurnNotification(params);
        if (!data) return;
        this.emit("turn:started", data.turn);
        this.emit("turn:started:notification", data);
        break;
      }
      case "turn/completed": {
        const data = asTurnCompletedNotification(params);
        if (!data) return;
        this.completedTurns.set(data.turn.id, data.turn);
        this.emit("turn:completed", data.turn);
        this.emit("turn:completed:notification", data);
        this.emit("_internal:turnCompleted", data);
        break;
      }
      case "item/started": {
        const data = asItemNotification(params);
        if (!data) return;
        this.emit("item:started", data.item);
        this.emit("item:started:notification", data);
        break;
      }
      case "item/completed": {
        const data = asItemNotification(params);
        if (!data) return;
        this.emit("item:completed", data.item);
        this.emit("item:completed:notification", data);
        this.emit("_internal:itemCompleted", data);
        break;
      }
      case "rawResponseItem/completed": {
        const data = asRawResponseItemCompletedNotification(params);
        if (!data) return;
        this.emit("rawResponseItem:completed", data.item);
        this.emit("rawResponseItem:completed:notification", data);
        break;
      }
      case "item/agentMessage/delta": {
        const data = asAgentDeltaNotification(params);
        if (!data) return;
        this.emit("item:agentMessage:delta", {
          itemId: data.itemId,
          delta: data.delta,
        });
        this.emit("item:agentMessage:delta:notification", data);
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
        this.emit("item:commandExecution:outputDelta:notification", data);
        break;
      }
      case "item/mcpToolCall/progress": {
        const data = asMcpToolCallProgressNotification(params);
        if (!data) return;
        this.emit("item:mcpToolCall:progress", {
          itemId: data.itemId,
          message: data.message,
        });
        this.emit("item:mcpToolCall:progress:notification", data);
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
        this.emit("turn:diff:updated:notification", data);
        this.emit("_internal:turnDiff", data);
        break;
      }
      case "turn/plan/updated": {
        const data = asPlanUpdatedNotification(params);
        if (!data) return;
        this.emit("turn:plan:updated", data);
        this.emit("turn:plan:updated:notification", data);
        break;
      }
      // "turn/plan/delta" is the pre-0.144 method name kept for older servers.
      case "item/plan/delta":
      case "turn/plan/delta": {
        const data = asPlanDeltaNotification(params);
        if (!data) return;
        this.emit("item:plan:delta", data);
        this.emit("turn:plan:delta", data);
        this.emit("turn:plan:delta:notification", data);
        break;
      }
      case "error": {
        const data = asErrorNotification(params);
        if (!data) return;
        this.emit("turn:error", data);
        break;
      }
      case "thread/tokenUsage/updated": {
        const data = asThreadTokenUsageUpdatedNotification(params);
        if (!data) return;
        this.emit("thread:tokenUsage:updated", data);
        break;
      }
      case "model/rerouted": {
        const data = asModelReroutedNotification(params);
        if (!data) return;
        this.emit("model:rerouted", data);
        break;
      }
      case "thread/deleted": {
        const data = asThreadLifecycleNotification(params);
        if (!data) return;
        this.emit("thread:deleted", data);
        break;
      }
      case "thread/compacted": {
        const data = asThreadCompactedNotification(params);
        if (!data) return;
        this.emit("thread:compacted", data);
        break;
      }
      case "deprecationNotice": {
        const data = asDeprecationNoticeNotification(params);
        if (!data) return;
        this.emit("deprecationNotice", data);
        break;
      }
      case "warning": {
        const data = asWarningNotification(params);
        if (!data) return;
        this.emit("warning", data);
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
      case "item/commandExecution/requestApproval": {
        const data = asApprovalRequestParams<CommandExecutionRequestApprovalParams>(message.params);
        if (!data) {
          return;
        }

        this.emit("request:commandExecutionApproval", {
          requestId: message.id,
          ...data,
        });
        break;
      }
      case "item/fileChange/requestApproval": {
        const data = asApprovalRequestParams<FileChangeRequestApprovalParams>(message.params);
        if (!data) {
          return;
        }

        this.emit("request:fileChangeApproval", {
          requestId: message.id,
          ...data,
        });
        break;
      }
      case "item/permissions/requestApproval": {
        const data = asApprovalRequestParams<PermissionsRequestApprovalParams>(message.params);
        if (!data) {
          return;
        }

        this.emit("request:permissionsApproval", {
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

  return [getDefaultShell(), "-lc", command];
}

function getDefaultCwd(): string {
  return getRuntimeProcess()?.cwd?.() ?? ".";
}

function getDefaultShell(): string {
  return getRuntimeProcess()?.env?.SHELL ?? "/bin/sh";
}

function getRuntimeProcess(): { cwd?: () => string; env?: Record<string, string | undefined> } | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: { cwd?: () => string; env?: Record<string, string | undefined> };
    }
  ).process;
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
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
      ...(typeof result.backwardsCursor === "string" || result.backwardsCursor === null
        ? { backwardsCursor: result.backwardsCursor }
        : {}),
    };
  }

  throw new Error("Invalid thread list response");
}

function extractLoadedThreadList(result: unknown): ThreadLoadedListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter((entry): entry is string => typeof entry === "string"),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
    };
  }

  throw new Error("Invalid loaded thread list response");
}

function extractThreadTurnsList(result: unknown): ThreadTurnsListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isTurn),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
      ...(typeof result.backwardsCursor === "string" || result.backwardsCursor === null
        ? { backwardsCursor: result.backwardsCursor }
        : {}),
    };
  }

  throw new Error("Invalid thread turns list response");
}

function extractThreadItemsList(result: unknown): ThreadItemsListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isThreadItemsListEntry),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
      ...(typeof result.backwardsCursor === "string" || result.backwardsCursor === null
        ? { backwardsCursor: result.backwardsCursor }
        : {}),
    };
  }

  throw new Error("Invalid thread items list response");
}

function extractModelList(result: unknown): ModelListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isModelInfo),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
    };
  }

  throw new Error("Invalid model list response");
}

function extractExperimentalFeatureList(result: unknown): ExperimentalFeatureListResult {
  if (isObject(result) && Array.isArray(result.data)) {
    return {
      data: result.data.filter(isExperimentalFeature),
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
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
      ...(typeof result.nextCursor === "string" || result.nextCursor === null ? { nextCursor: result.nextCursor } : {}),
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
  if (isObject(result) && "requirements" in result) {
    return {
      requirements:
        isObject(result.requirements) || result.requirements === null
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
      ...(typeof params.startedAtMs === "number" ? { startedAtMs: params.startedAtMs } : {}),
      ...(typeof params.completedAtMs === "number" ? { completedAtMs: params.completedAtMs } : {}),
    };
  }

  return null;
}

function asRawResponseItemCompletedNotification(params: unknown): RawResponseItemCompletedNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    isResponseItem(params.item)
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

function asMcpToolCallProgressNotification(params: unknown): McpToolCallProgressNotification | null {
  const message = getString(params, "message") ?? getString(params, "delta");
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.itemId === "string" &&
    message !== undefined
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      message,
    };
  }

  return null;
}

function asCommandExecOutputDeltaNotification(params: unknown): CommandExecOutputDeltaNotification | null {
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
  if (isObject(params) && typeof params.threadId === "string" && isThreadStatus(params.status)) {
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
      ...(typeof params.autoResolutionMs === "number" || params.autoResolutionMs === null
        ? { autoResolutionMs: params.autoResolutionMs }
        : {}),
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

function asErrorNotification(params: unknown): ErrorNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.willRetry === "boolean" &&
    isObject(params.error) &&
    typeof params.error.message === "string"
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      willRetry: params.willRetry,
      error: params.error as TurnError,
    };
  }

  return null;
}

function asThreadTokenUsageUpdatedNotification(params: unknown): ThreadTokenUsageUpdatedNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    isObject(params.tokenUsage)
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      tokenUsage: params.tokenUsage as unknown as ThreadTokenUsage,
    };
  }

  return null;
}

function asModelReroutedNotification(params: unknown): ModelReroutedNotification | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.fromModel === "string" &&
    typeof params.toModel === "string" &&
    typeof params.reason === "string"
  ) {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
      fromModel: params.fromModel,
      toModel: params.toModel,
      reason: params.reason,
    };
  }

  return null;
}

function asThreadCompactedNotification(params: unknown): ThreadCompactedNotification | null {
  if (isObject(params) && typeof params.threadId === "string" && typeof params.turnId === "string") {
    return {
      threadId: params.threadId,
      turnId: params.turnId,
    };
  }

  return null;
}

function asDeprecationNoticeNotification(params: unknown): DeprecationNoticeNotification | null {
  if (isObject(params) && typeof params.summary === "string") {
    return {
      summary: params.summary,
      ...(typeof params.details === "string" || params.details === null ? { details: params.details } : {}),
    };
  }

  return null;
}

function asWarningNotification(params: unknown): WarningNotification | null {
  if (isObject(params) && typeof params.message === "string") {
    return {
      message: params.message,
      ...(typeof params.threadId === "string" || params.threadId === null ? { threadId: params.threadId } : {}),
    };
  }

  return null;
}

function asApprovalRequestParams<T extends { threadId: string; turnId: string; itemId: string }>(
  params: unknown,
): T | null {
  if (
    isObject(params) &&
    typeof params.threadId === "string" &&
    typeof params.turnId === "string" &&
    typeof params.itemId === "string"
  ) {
    return params as T;
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

function isThreadStatus(value: unknown): value is ThreadStatusChangedNotification["status"] {
  if (!isObject(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "notLoaded" || value.type === "idle" || value.type === "systemError") {
    return true;
  }

  return value.type === "active" && Array.isArray(value.activeFlags);
}

function isTurn(value: unknown): value is Turn {
  return (
    isObject(value) && typeof value.id === "string" && typeof value.status === "string" && Array.isArray(value.items)
  );
}

function isThreadItem(value: unknown): value is ThreadItem {
  return isObject(value) && typeof value.id === "string" && typeof value.type === "string";
}

function isThreadItemEntry(value: unknown): value is ThreadItemEntry {
  return isObject(value) && typeof value.turnId === "string" && isThreadItem(value.item);
}

function isThreadItemsListEntry(value: unknown): value is ThreadItemsListEntry {
  return isThreadItem(value) || isThreadItemEntry(value);
}

function isResponseItem(value: unknown): value is ResponseItem {
  return isObject(value) && typeof value.type === "string";
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
  return isObject(value) && typeof value.name === "string" && "mode" in value;
}

function isSkillsListEntry(value: unknown): value is SkillsListResult["data"][number] {
  return isObject(value) && typeof value.cwd === "string" && Array.isArray(value.skills) && Array.isArray(value.errors);
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
