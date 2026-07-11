export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  id: RequestId;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type RequestId = string | number;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * Open string in codex-cli 0.144+; per-model valid values come from
 * `Model.supportedReasoningEfforts` via `model/list`.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | string;
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access" | string;
export interface GranularApprovalPolicy {
  sandbox_approval: boolean;
  rules: boolean;
  skill_approval: boolean;
  request_permissions: boolean;
  mcp_elicitations: boolean;
}
export type ApprovalPolicy = "untrusted" | "on-request" | "never" | { granular: GranularApprovalPolicy };
export type Personality = "friendly" | "pragmatic" | "none" | string;
export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";
export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: ThreadActiveFlag[] };
export type TurnStatus = "inProgress" | "completed" | "interrupted" | "failed";
export type WriteStatus = "ok" | "okOverridden";
export type ThreadUnsubscribeStatus = "notLoaded" | "notSubscribed" | "unsubscribed";
export type CommandExecOutputStream = "stdout" | "stderr";
export type SortDirection = "asc" | "desc";
export type TurnItemsView = "notLoaded" | "summary" | "full";
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type ThreadSource = "user" | "subagent" | "memory_consolidation";
export type ThreadSourceKind = "local" | "remote" | string;
export type ThreadStartSource = "startup" | "clear";
export type ThreadHistoryMode = "legacy" | "paginated";
export type CollaborationModeKind = "plan" | "default";
export type ImageDetail = "auto" | "low" | "high" | "original";
export type MessagePhase = "commentary" | "final_answer";

export type FunctionCallOutputContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: ImageDetail };
export type FunctionCallOutputBody = string | FunctionCallOutputContentItem[];
export type ContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: ImageDetail }
  | { type: "output_text"; text: string };
export type ResponseItem =
  | { type: "message"; role: string; content: ContentItem[]; phase?: MessagePhase | null }
  | { type: "function_call"; name: string; namespace?: string; arguments: string; call_id: string }
  | { type: "function_call_output"; call_id: string; output: FunctionCallOutputBody }
  | { type: "custom_tool_call"; status?: string; call_id: string; name: string; input: string }
  | {
      type: "custom_tool_call_output";
      call_id: string;
      name?: string;
      output: FunctionCallOutputBody;
    }
  | { type: "image_generation_call"; id: string; status: string; revised_prompt?: string; result: string }
  | { type: "reasoning"; summary: unknown[]; content?: unknown[] | null; encrypted_content: string | null }
  | { type: string; [key: string]: unknown };

export type CodexErrorInfo =
  | "contextWindowExceeded"
  | "sessionBudgetExceeded"
  | "usageLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | "other"
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: "review" | "compact" | string } }
  | string;

export interface TurnError {
  message: string;
  codexErrorInfo?: CodexErrorInfo | null;
  additionalDetails?: string | null;
  [key: string]: unknown;
}

export interface FileChange {
  path?: string;
  kind?: string;
  diff?: string;
  [key: string]: unknown;
}

export type CommandExecutionSource = "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";
export type CommandExecutionStatus = string;
export type CommandAction =
  | { type: "read"; command: string; name: string; path: string }
  | { type: "listFiles"; command: string; path: string }
  | { type: "search"; command: string; query: string; path: string }
  | { type: "unknown"; command: string };
export type PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";
export type McpToolCallStatus = "inProgress" | "completed" | "failed";
export interface McpToolCallResult {
  content: JsonValue[];
  structuredContent: JsonValue | null;
  _meta: JsonValue | null;
}
export interface McpToolCallError {
  message: string;
}
export type DynamicToolCallStatus = "inProgress" | "completed" | "failed";
export type DynamicToolCallOutputContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string };
export type CollabAgentTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent";
export type CollabAgentToolCallStatus = "inProgress" | "completed" | "failed";
export interface CollabAgentState {
  [key: string]: JsonValue | undefined;
}
export type WebSearchAction =
  | { type: "search"; query: string | null; queries: string[] | null }
  | { type: "openPage"; url: string | null }
  | { type: "findInPage"; url: string | null; pattern: string | null }
  | { type: "other" };
export interface HookPromptFragment {
  text: string;
  hookRunId: string;
}
export interface MemoryCitation {
  [key: string]: JsonValue | undefined;
}

export type ThreadItem =
  | { type: "userMessage"; id: string; clientId?: string | null; content: unknown[] }
  | { type: "hookPrompt"; id: string; fragments: HookPromptFragment[] }
  | { type: "agentMessage"; id: string; text: string; phase?: string | null; memoryCitation?: MemoryCitation | null }
  | { type: "imageView"; id: string; path: string }
  | {
      type: "imageGeneration";
      id: string;
      status: string;
      revisedPrompt: string | null;
      result: string;
      savedPath?: string;
    }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd?: string;
      processId?: string | null;
      source?: CommandExecutionSource;
      status: CommandExecutionStatus;
      exitCode?: number | null;
      aggregatedOutput?: string | null;
      durationMs?: number | null;
      commandActions?: CommandAction[];
    }
  | { type: "fileChange"; id: string; changes: FileChange[]; status: PatchApplyStatus | string }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: McpToolCallStatus;
      arguments: JsonValue;
      mcpAppResourceUri?: string;
      result: McpToolCallResult | null;
      error: McpToolCallError | null;
      durationMs: number | null;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      arguments: JsonValue;
      status: DynamicToolCallStatus;
      contentItems: DynamicToolCallOutputContentItem[] | null;
      success: boolean | null;
      durationMs: number | null;
    }
  | {
      type: "collabAgentToolCall";
      id: string;
      tool: CollabAgentTool;
      status: CollabAgentToolCallStatus;
      senderThreadId: string;
      receiverThreadIds: string[];
      prompt: string | null;
      model: string | null;
      reasoningEffort: ReasoningEffort | null;
      agentsStates: Record<string, CollabAgentState | undefined>;
    }
  | { type: "webSearch"; id: string; query: string; action: WebSearchAction | null }
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "reasoning"; id: string; summary?: unknown; content?: unknown }
  | { type: "plan"; id: string; text: string }
  | { type: "contextCompaction"; id: string }
  | { type: string; id: string; [key: string]: unknown };

export interface Turn {
  id: string;
  status: TurnStatus;
  items: ThreadItem[];
  itemsView?: TurnItemsView;
  error?: TurnError | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export interface GitInfo {
  sha?: string | null;
  branch?: string | null;
  originUrl?: string | null;
  [key: string]: unknown;
}

export interface Thread {
  id: string;
  /** Experimental implementation-specific thread data. */
  extra?: Record<string, unknown> | null;
  sessionId?: string;
  forkedFromId?: string | null;
  parentThreadId?: string | null;
  preview?: string;
  ephemeral?: boolean;
  historyMode?: ThreadHistoryMode;
  modelProvider?: string;
  createdAt?: number;
  updatedAt?: number;
  recencyAt?: number | null;
  status?: ThreadStatus;
  path?: string | null;
  cwd?: string;
  cliVersion?: string;
  source?: string;
  threadSource?: ThreadSource | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  gitInfo?: GitInfo | null;
  name?: string | null;
  turns?: Turn[];
}

export interface PlanEntry {
  status?: string;
  step?: string;
  [key: string]: unknown;
}

export interface SandboxPolicy {
  type: string;
  writableRoots?: string[];
  readOnlyAccess?: unknown;
  access?: unknown;
  networkAccess?: boolean | "restricted" | "enabled";
  excludeTmpdirEnvVar?: boolean;
  excludeSlashTmp?: boolean;
  [key: string]: unknown;
}

export type TurnInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string }
  | { type: string; [key: string]: unknown };

export interface CollaborationModeSettings {
  model: string;
  reasoning_effort: ReasoningEffort | null;
  developer_instructions: string | null;
}

export interface CollaborationMode {
  mode: CollaborationModeKind;
  settings: CollaborationModeSettings;
}

export interface CollaborationModeMask {
  name: string;
  mode: CollaborationModeKind | null;
  model: string | null;
  reasoning_effort: ReasoningEffort | null;
}

export interface StartThreadParams {
  model?: string;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode;
  config?: Record<string, JsonValue | undefined>;
  serviceName?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Personality;
  ephemeral?: boolean;
  sessionStartSource?: ThreadStartSource | null;
  threadSource?: ThreadSource | null;
  /** Experimental raw Responses API events; omitted unless explicitly set. */
  experimentalRawEvents?: boolean;
}

export interface ResumeThreadParams {
  /** Experimental in-memory history used instead of loading the stored rollout. */
  history?: ResponseItem[] | null;
  /** Experimental rollout path override. Prefer resuming by thread id. */
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, JsonValue | undefined> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Personality | null;
  /** Experimental: omit reconstructed turns from the returned thread. */
  excludeTurns?: boolean;
  /** Experimental: include one turns page in the resume response. */
  initialTurnsPage?: ThreadResumeInitialTurnsPageParams | null;
}

export interface ForkThreadParams {
  /**
   * Optional last turn id to fork through, inclusive. Turns after
   * `lastTurnId` are omitted from the fork.
   */
  lastTurnId?: string | null;
  /** Experimental rollout path override. Prefer forking by thread id. */
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, JsonValue | undefined> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  threadSource?: ThreadSource | null;
  /** Experimental: omit reconstructed turns from the returned thread. */
  excludeTurns?: boolean;
}

export interface ThreadResumeParams extends ResumeThreadParams {
  threadId: string;
}

export interface ThreadForkParams extends ForkThreadParams {
  threadId: string;
}

export interface ListThreadsParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: "created_at" | "updated_at" | string | null;
  sortDirection?: SortDirection | null;
  modelProviders?: string[] | null;
  sourceKinds?: ThreadSourceKind[] | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
  useStateDbOnly?: boolean;
  searchTerm?: string | null;
}

export interface ListLoadedThreadsParams {
  cursor?: string | null;
  limit?: number | null;
}

/** Experimental turn-history pagination. */
export interface ThreadTurnsListParams {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
  sortDirection?: SortDirection | null;
  itemsView?: TurnItemsView | null;
}

/** Experimental persisted-item pagination, optionally scoped to one turn. */
export interface ThreadItemsListParams {
  threadId: string;
  turnId?: string | null;
  cursor?: string | null;
  limit?: number | null;
  sortDirection?: SortDirection | null;
}

/** @deprecated Use `ThreadItemsListParams`; this alias requires a turn filter. */
export interface ThreadTurnsItemsListParams extends ThreadItemsListParams {
  turnId: string;
}

export interface ThreadResumeInitialTurnsPageParams {
  limit?: number | null;
  sortDirection?: SortDirection | null;
  itemsView?: TurnItemsView | null;
}

export interface StartTurnParams {
  threadId: string;
  input: TurnInput[];
  /**
   * Optional client-supplied id echoed back as `clientId` on the
   * corresponding `userMessage` thread item.
   */
  clientUserMessageId?: string | null;
  cwd?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  summary?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandboxPolicy?: SandboxPolicy | null;
  personality?: Personality | null;
  outputSchema?: JsonValue | null;
  /** Experimental pre-set collaboration mode. */
  collaborationMode?: CollaborationMode | null;
}

export interface SteerTurnParams {
  threadId: string;
  input: TurnInput[];
  expectedTurnId: string;
}

export interface StartReviewParams {
  threadId: string;
  delivery?: "inline" | "detached";
  target: ReviewTarget;
}

export interface ListModelsParams {
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
}

export interface ExperimentalFeatureListParams {
  cursor?: string | null;
  limit?: number | null;
}

export interface SkillsListParams {
  cwds?: string[];
  forceReload?: boolean;
}

export interface AppListParams {
  cursor?: string | null;
  limit?: number | null;
  threadId?: string | null;
  forceRefetch?: boolean;
}

export interface ConfigReadParams {
  includeLayers?: boolean;
  cwd?: string | null;
}

export type MergeStrategy = "replace" | "upsert";

export interface ConfigEdit {
  keyPath: string;
  value: JsonValue;
  mergeStrategy: MergeStrategy;
}

export interface ConfigValueWriteParams {
  keyPath: string;
  value: JsonValue;
  mergeStrategy: MergeStrategy;
  filePath?: string | null;
  expectedVersion?: string | null;
}

export interface ConfigBatchWriteParams {
  edits: ConfigEdit[];
  filePath?: string | null;
  expectedVersion?: string | null;
  reloadUserConfig?: boolean;
}

export interface ExecCommandParams {
  command: string | string[];
  processId?: string | null;
  tty?: boolean;
  streamStdin?: boolean;
  streamStdoutStderr?: boolean;
  outputBytesCap?: number | null;
  disableOutputCap?: boolean;
  disableTimeout?: boolean;
  timeoutMs?: number | null;
  cwd?: string | null;
  env?: Record<string, string | null> | null;
  size?: { rows: number; cols: number } | null;
  sandboxPolicy?: SandboxPolicy | null;
}

export interface CommandExecWriteParams {
  processId: string;
  deltaBase64?: string | null;
  closeStdin?: boolean;
}

export interface CommandExecResizeParams {
  processId: string;
  size: { rows: number; cols: number };
}

export interface CommandExecTerminateParams {
  processId: string;
}

export interface ReasoningEffortOption {
  effort: ReasoningEffort;
  label?: string;
  [key: string]: unknown;
}

export interface ModelUpgradeInfo {
  model?: string | null;
  upgradeCopy?: string | null;
  modelLink?: string | null;
  migrationMarkdown?: string | null;
  [key: string]: unknown;
}

export interface ModelAvailabilityNux {
  [key: string]: unknown;
}

export interface ModelServiceTier {
  id: string;
  name: string;
  description: string;
}

export interface ModelInfo {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: ReasoningEffortOption[];
  defaultReasoningEffort?: ReasoningEffort;
  inputModalities?: string[];
  supportsPersonality?: boolean;
  upgrade?: string | null;
  upgradeInfo?: ModelUpgradeInfo | null;
  availabilityNux?: ModelAvailabilityNux | null;
  /**
   * Deprecated by Codex in favor of serviceTiers, but retained for older hosts.
   */
  additionalSpeedTiers?: string[];
  serviceTiers?: ModelServiceTier[];
  isDefault?: boolean;
}

export interface ModelListResult {
  data: ModelInfo[];
  nextCursor?: string | null;
}

export interface ExperimentalFeature {
  name: string;
  stage: string;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
  enabled: boolean;
  defaultEnabled: boolean;
}

export interface ExperimentalFeatureListResult {
  data: ExperimentalFeature[];
  nextCursor?: string | null;
}

export interface CollaborationModeListResult {
  data: CollaborationModeMask[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  path: string;
  scope: string;
  enabled: boolean;
}

export interface SkillErrorInfo {
  path?: string;
  message?: string;
  [key: string]: unknown;
}

export interface SkillsListEntry {
  cwd: string;
  skills: SkillMetadata[];
  errors: SkillErrorInfo[];
}

export interface SkillsListResult {
  data: SkillsListEntry[];
}

export interface AppInfo {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  logoUrlDark: string | null;
  distributionChannel: string | null;
  branding: Record<string, unknown> | null;
  appMetadata: Record<string, unknown> | null;
  labels: Record<string, string> | null;
  installUrl: string | null;
  isAccessible: boolean;
  isEnabled: boolean;
  pluginDisplayNames: string[];
}

export interface AppListResult {
  data: AppInfo[];
  nextCursor?: string | null;
}

export interface ThreadListResult {
  data: Thread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

export interface ThreadLoadedListResult {
  data: string[];
  nextCursor?: string | null;
}

export interface ThreadTurnsListResult {
  data: Turn[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

export interface ThreadItemsListResult {
  data: ThreadItem[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

/** @deprecated Use `ThreadItemsListResult`. */
export type ThreadTurnsItemsListResult = ThreadItemsListResult;

export interface ThreadResponse {
  thread: Thread;
}

export interface ActivePermissionProfile {
  id: string;
  extends: string | null;
}

/** Current app-server metadata returned when a thread becomes live. */
export interface ThreadStartResponse extends ThreadResponse {
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
  instructionSources: string[];
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: SandboxPolicy;
  reasoningEffort: ReasoningEffort | null;
  /** Experimental fields present when the matching capability is enabled. */
  runtimeWorkspaceRoots?: string[];
  activePermissionProfile?: ActivePermissionProfile | null;
  multiAgentMode?: string;
  [key: string]: unknown;
}

export interface ThreadResumeResponse extends ThreadStartResponse {
  /** Experimental page requested through `initialTurnsPage`. */
  initialTurnsPage?: ThreadTurnsListResult | null;
}

export type ThreadForkResponse = ThreadStartResponse;

export interface ThreadUnsubscribeResult {
  status: ThreadUnsubscribeStatus;
}

export interface ExecCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ConfigReadResult {
  config: Record<string, unknown>;
  origins: Record<string, { name?: unknown; version?: unknown }>;
  layers: unknown[] | null;
}

export interface ConfigWriteResult {
  status: WriteStatus;
  version: string;
  filePath: string;
  overriddenMetadata?: Record<string, unknown> | null;
}

export interface ConfigRequirements {
  allowedApprovalPolicies?: ApprovalPolicy[] | null;
  allowedSandboxModes?: SandboxMode[] | null;
  allowedWebSearchModes?: string[] | null;
  featureRequirements?: Record<string, boolean> | null;
  enforceResidency?: unknown;
}

export interface ConfigRequirementsReadResult {
  requirements: ConfigRequirements | null;
}

export interface ReviewResult {
  turn?: Turn;
  reviewThreadId?: string;
  [key: string]: unknown;
}

export interface CompletedTurn {
  turn: Turn;
  items: ThreadItem[];
  agentMessage: string;
  diff?: string;
}

export interface CompletedReview {
  turn: Turn;
  reviewText: string;
}

/** Identity of the locally spawned Codex app-server process. */
export interface CodexProcessInfo {
  readonly pid: number;
  /** Present only when the client spawned a detached POSIX process group. */
  readonly pgid?: number;
}

export interface CodexClientOptions {
  clientName?: string;
  clientTitle?: string;
  clientVersion?: string;
  /**
   * Default model for new threads. When omitted, `thread/start` is sent
   * without a model and the server falls back to the user's config default
   * (`model` in `~/.codex/config.toml`). Use `listModels()` and the
   * `isDefault` flag to discover the catalog default.
   */
  model?: string;
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxMode;
  experimentalApi?: boolean;
  /** Opt into `attestation/generate` server requests. */
  requestAttestation?: boolean;
  /** Allow downstream MCP servers to request OpenAI extended form elicitations. */
  mcpServerOpenaiFormElicitation?: boolean;
  optOutNotificationMethods?: string[];
  codexPath?: string;
  /**
   * Spawn app-server as a detached process-group leader. Defaults to false.
   * On POSIX, processInfo.pgid then equals processInfo.pid. Windows has no PGID.
   */
  detached?: boolean;
  /**
   * Extra CLI arguments appended after `app-server` when spawning the stdio
   * transport, e.g. `["proxy"]` to attach to a shared daemon via
   * `codex app-server proxy`, or `["-c", "key=value"]` config overrides.
   */
  spawnArgs?: string[];
}

export interface TurnStartedNotification {
  threadId: string;
  turn: Turn;
}

export interface ToolRequestUserInputOption {
  label: string;
  description: string;
}

export interface ToolRequestUserInputQuestion {
  header: string;
  id: string;
  question: string;
  isOther?: boolean;
  isSecret?: boolean;
  options?: ToolRequestUserInputOption[] | null;
}

export interface ToolRequestUserInputParams {
  itemId: string;
  threadId: string;
  turnId: string;
  questions: ToolRequestUserInputQuestion[];
  /**
   * When set, the server may auto-resolve the request after this many
   * milliseconds if no answer arrives.
   */
  autoResolutionMs?: number | null;
}

export interface ToolRequestUserInputAnswer {
  answers: string[];
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, ToolRequestUserInputAnswer>;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: Turn;
}

export interface ItemNotification {
  threadId: string;
  turnId: string;
  item: ThreadItem;
  /** Unix timestamp (ms) when the item started; sent on `item/started`. */
  startedAtMs?: number;
  /** Unix timestamp (ms) when the item completed; sent on `item/completed`. */
  completedAtMs?: number;
}

export interface RawResponseItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: ResponseItem;
}

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface CommandOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface McpToolCallProgressNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  message: string;
}

export interface CommandExecOutputDeltaNotification {
  processId: string;
  stream: CommandExecOutputStream;
  deltaBase64: string;
  capReached: boolean;
}

export interface DiffUpdatedNotification {
  threadId: string;
  turnId: string;
  diff: string;
}

export interface PlanUpdatedNotification {
  threadId?: string;
  turnId: string;
  explanation?: string | null;
  plan: PlanEntry[];
}

export interface PlanDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ThreadStartedNotification {
  thread: Thread;
}

export interface ThreadStatusChangedNotification {
  threadId: string;
  status: ThreadStatus;
}

export interface ThreadLifecycleNotification {
  threadId: string;
}

export interface ThreadNameUpdatedNotification {
  threadId: string;
  threadName?: string;
}

export interface AppListUpdatedNotification {
  data: AppInfo[];
}

export interface ServerRequestResolvedNotification {
  threadId: string;
  requestId: RequestId;
}

export interface ErrorNotification {
  threadId: string;
  turnId: string;
  error: TurnError;
  willRetry: boolean;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface ThreadTokenUsageUpdatedNotification {
  threadId: string;
  turnId: string;
  tokenUsage: ThreadTokenUsage;
}

export interface ModelReroutedNotification {
  threadId: string;
  turnId: string;
  fromModel: string;
  toModel: string;
  reason: "highRiskCyberActivity" | string;
}

export interface ThreadCompactedNotification {
  threadId: string;
  turnId: string;
}

export interface DeprecationNoticeNotification {
  summary: string;
  details?: string | null;
}

export interface WarningNotification {
  threadId?: string | null;
  message: string;
}

export type ExecPolicyAmendment = string[];
export type NetworkPolicyRuleAction = "allow" | "deny";

export interface NetworkPolicyAmendment {
  host: string;
  action: NetworkPolicyRuleAction;
}

export interface NetworkApprovalContext {
  host: string;
  protocol: "http" | "https" | "socks5Tcp" | "socks5Udp" | string;
}

export interface CommandExecutionRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs?: number;
  /** Distinct callback id when multiple approvals belong to one item. */
  approvalId?: string | null;
  environmentId?: string | null;
  reason?: string | null;
  networkApprovalContext?: NetworkApprovalContext | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: CommandAction[] | null;
  proposedExecpolicyAmendment?: ExecPolicyAmendment | null;
  proposedNetworkPolicyAmendments?: NetworkPolicyAmendment[] | null;
  [key: string]: unknown;
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs?: number;
  reason?: string | null;
  /** When set, the agent asks to allow writes under this root for the session. */
  grantRoot?: string | null;
  [key: string]: unknown;
}

export interface AdditionalNetworkPermissions {
  enabled?: boolean | null;
  [key: string]: unknown;
}

export interface AdditionalFileSystemPermissions {
  read?: string[] | null;
  write?: string[] | null;
  globScanMaxDepth?: number;
  entries?: unknown[];
  [key: string]: unknown;
}

export interface RequestPermissionProfile {
  network?: AdditionalNetworkPermissions | null;
  fileSystem?: AdditionalFileSystemPermissions | null;
}

export interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs?: number;
  environmentId?: string | null;
  cwd?: string;
  reason?: string | null;
  permissions?: RequestPermissionProfile;
  [key: string]: unknown;
}

export type CommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: ExecPolicyAmendment } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: NetworkPolicyAmendment } };

export type FileChangeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CommandExecutionRequestApprovalResponse {
  decision: CommandExecutionApprovalDecision;
}

export interface FileChangeRequestApprovalResponse {
  decision: FileChangeApprovalDecision;
}

export interface GrantedPermissionProfile {
  network?: AdditionalNetworkPermissions;
  fileSystem?: AdditionalFileSystemPermissions;
}

export type PermissionGrantScope = "turn" | "session";

export interface PermissionsRequestApprovalResponse {
  permissions: GrantedPermissionProfile;
  scope: PermissionGrantScope;
  /** Review every subsequent command in this turn before sandboxed execution. */
  strictAutoReview?: boolean;
}

export interface InitializeCapabilities {
  experimentalApi: boolean;
  /** Opt into `attestation/generate` server requests. Defaults to false. */
  requestAttestation?: boolean;
  /** Allow downstream MCP servers to request OpenAI extended form elicitations. */
  mcpServerOpenaiFormElicitation?: boolean;
  optOutNotificationMethods?: string[] | null;
}

export interface InitializeParams {
  clientInfo: {
    name: string;
    title: string | null;
    version: string;
  };
  capabilities: InitializeCapabilities | null;
}

export interface InitializeResponse {
  userAgent: string;
  /** Absolute path to the server's `$CODEX_HOME` directory (codex-cli 0.144+). */
  codexHome?: string;
  /** Platform family of the app-server, e.g. `"unix"` or `"windows"` (codex-cli 0.144+). */
  platformFamily?: string;
  /** Operating system of the app-server, e.g. `"macos"` (codex-cli 0.144+). */
  platformOs?: string;
}

export interface CodexClientRequestMap {
  initialize: {
    params: InitializeParams;
    result: InitializeResponse;
  };
  "thread/start": {
    params: StartThreadParams;
    result: ThreadStartResponse;
  };
  "thread/resume": {
    params: ThreadResumeParams;
    result: ThreadResumeResponse;
  };
  "thread/fork": {
    params: ThreadForkParams;
    result: ThreadForkResponse;
  };
  "thread/read": {
    params: { threadId: string; includeTurns: boolean };
    result: ThreadResponse;
  };
  "thread/list": {
    params: ListThreadsParams;
    result: ThreadListResult;
  };
  "thread/turns/list": {
    params: ThreadTurnsListParams;
    result: ThreadTurnsListResult;
  };
  "thread/items/list": {
    params: ThreadItemsListParams;
    result: ThreadItemsListResult;
  };
  "thread/loaded/list": {
    params: ListLoadedThreadsParams;
    result: ThreadLoadedListResult;
  };
  "thread/archive": {
    params: { threadId: string };
    result: Record<string, never>;
  };
  "thread/unarchive": {
    params: { threadId: string };
    result: ThreadResponse;
  };
  "thread/delete": {
    params: { threadId: string };
    result: Record<string, never>;
  };
  "thread/unsubscribe": {
    params: { threadId: string };
    result: ThreadUnsubscribeResult;
  };
  "thread/name/set": {
    params: { threadId: string; name: string };
    result: Record<string, never>;
  };
  "thread/compact/start": {
    params: { threadId: string };
    result: Record<string, never>;
  };
  "thread/rollback": {
    params: { threadId: string; numTurns: number };
    result: ThreadResponse;
  };
  "turn/start": {
    params: StartTurnParams;
    result: { turn: Turn };
  };
  "turn/steer": {
    params: SteerTurnParams;
    result: { turnId: string };
  };
  "turn/interrupt": {
    params: { threadId: string; turnId: string };
    result: Record<string, never>;
  };
  "review/start": {
    params: StartReviewParams;
    result: ReviewResult;
  };
  "model/list": {
    params: ListModelsParams;
    result: ModelListResult;
  };
  "experimentalFeature/list": {
    params: ExperimentalFeatureListParams;
    result: ExperimentalFeatureListResult;
  };
  "collaborationMode/list": {
    params: Record<string, never>;
    result: CollaborationModeListResult;
  };
  "skills/list": {
    params: SkillsListParams;
    result: SkillsListResult;
  };
  "app/list": {
    params: AppListParams;
    result: AppListResult;
  };
  "config/read": {
    params: ConfigReadParams;
    result: ConfigReadResult;
  };
  "config/value/write": {
    params: ConfigValueWriteParams;
    result: ConfigWriteResult;
  };
  "config/batchWrite": {
    params: ConfigBatchWriteParams;
    result: ConfigWriteResult;
  };
  "configRequirements/read": {
    params: Record<string, never>;
    result: ConfigRequirementsReadResult;
  };
  "command/exec": {
    params: ExecCommandParams;
    result: ExecCommandResult;
  };
  "command/exec/write": {
    params: CommandExecWriteParams;
    result: Record<string, never>;
  };
  "command/exec/resize": {
    params: CommandExecResizeParams;
    result: Record<string, never>;
  };
  "command/exec/terminate": {
    params: CommandExecTerminateParams;
    result: Record<string, never>;
  };
}

export type CodexClientMethod = keyof CodexClientRequestMap;
export type CodexClientRequestParams<Method extends CodexClientMethod> = CodexClientRequestMap[Method]["params"];
export type CodexClientRequestResult<Method extends CodexClientMethod> = CodexClientRequestMap[Method]["result"];

export interface CodexClientEventMap {
  error: [Error];
  stderr: [string];
  "turn:started": [Turn];
  "turn:started:notification": [TurnStartedNotification];
  "turn:completed": [Turn];
  "turn:completed:notification": [TurnCompletedNotification];
  "item:started": [ThreadItem];
  "item:started:notification": [ItemNotification];
  "item:completed": [ThreadItem];
  "item:completed:notification": [ItemNotification];
  "rawResponseItem:completed": [ResponseItem];
  "rawResponseItem:completed:notification": [RawResponseItemCompletedNotification];
  "item:agentMessage:delta": [{ itemId: string; delta: string }];
  "item:agentMessage:delta:notification": [AgentMessageDeltaNotification];
  "item:commandExecution:outputDelta": [{ itemId: string; delta: string }];
  "item:commandExecution:outputDelta:notification": [CommandOutputDeltaNotification];
  "item:mcpToolCall:progress": [{ itemId: string; message: string }];
  "item:mcpToolCall:progress:notification": [McpToolCallProgressNotification];
  "command:exec:outputDelta": [CommandExecOutputDeltaNotification];
  "turn:diff:updated": [DiffUpdatedNotification];
  "turn:diff:updated:notification": [DiffUpdatedNotification];
  "turn:plan:updated": [PlanUpdatedNotification];
  "turn:plan:updated:notification": [PlanUpdatedNotification];
  "item:plan:delta": [PlanDeltaNotification];
  /** @deprecated Alias of `item:plan:delta` kept for backward compatibility. */
  "turn:plan:delta": [PlanDeltaNotification];
  /** @deprecated Alias of `item:plan:delta` kept for backward compatibility. */
  "turn:plan:delta:notification": [PlanDeltaNotification];
  "turn:error": [ErrorNotification];
  "thread:started": [Thread];
  "thread:status:changed": [ThreadStatusChangedNotification];
  "thread:archived": [ThreadLifecycleNotification];
  "thread:unarchived": [ThreadLifecycleNotification];
  "thread:deleted": [ThreadLifecycleNotification];
  "thread:closed": [ThreadLifecycleNotification];
  "thread:compacted": [ThreadCompactedNotification];
  "thread:name:updated": [ThreadNameUpdatedNotification];
  "thread:tokenUsage:updated": [ThreadTokenUsageUpdatedNotification];
  "model:rerouted": [ModelReroutedNotification];
  deprecationNotice: [DeprecationNoticeNotification];
  warning: [WarningNotification];
  "app:list:updated": [AppListUpdatedNotification];
  "serverRequest:resolved": [ServerRequestResolvedNotification];
  "skills:changed": [];
  "request:userInput": [ToolRequestUserInputParams & { requestId: RequestId }];
  "request:commandExecutionApproval": [CommandExecutionRequestApprovalParams & { requestId: RequestId }];
  "request:fileChangeApproval": [FileChangeRequestApprovalParams & { requestId: RequestId }];
  "request:permissionsApproval": [PermissionsRequestApprovalParams & { requestId: RequestId }];
  "server:request": [JsonRpcRequest];
  /** Every server notification, including methods without first-class events. */
  notification: [JsonRpcNotification];
}
