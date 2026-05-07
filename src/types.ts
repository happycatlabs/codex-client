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

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access" | string;
export type ApprovalPolicy = string | { reject: Record<string, boolean> };
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

export interface TurnError {
  message: string;
  codexErrorInfo?: string;
  [key: string]: unknown;
}

export interface FileChange {
  path?: string;
  kind?: string;
  diff?: string;
  [key: string]: unknown;
}

export type ThreadItem =
  | { type: "userMessage"; id: string; content: unknown[] }
  | { type: "agentMessage"; id: string; text: string; phase?: string | null }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd?: string;
      processId?: string | null;
      status: string;
      exitCode?: number | null;
      aggregatedOutput?: string | null;
      durationMs?: number | null;
      commandActions?: unknown[];
    }
  | { type: "fileChange"; id: string; changes: FileChange[]; status: string }
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
  error?: TurnError | null;
}

export interface GitInfo {
  sha?: string | null;
  branch?: string | null;
  originUrl?: string | null;
  [key: string]: unknown;
}

export interface Thread {
  id: string;
  forkedFromId?: string | null;
  preview?: string;
  ephemeral?: boolean;
  modelProvider?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: ThreadStatus;
  path?: string | null;
  cwd?: string;
  cliVersion?: string;
  source?: string;
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
  | { type: "baseBranch" }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom" }
  | { type: string; [key: string]: unknown };

export interface CollaborationModeSettings {
  model: string;
  reasoning_effort: ReasoningEffort | null;
  developer_instructions: string | null;
}

export interface CollaborationMode {
  mode: "plan" | "default";
  settings: CollaborationModeSettings;
}

export interface CollaborationModeMask {
  name: string;
  mode: "plan" | "default" | null;
  model: string | null;
  reasoning_effort: ReasoningEffort | null;
}

export interface StartThreadParams {
  model?: string;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxMode;
  config?: Record<string, JsonValue | undefined>;
  serviceName?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Personality;
  ephemeral?: boolean;
  experimentalRawEvents?: boolean;
  persistExtendedHistory?: boolean;
}

export interface ResumeThreadParams {
  path?: string | null;
  history?: unknown[] | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, JsonValue | undefined> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Personality | null;
  excludeTurns?: boolean;
  persistExtendedHistory?: boolean;
}

export interface ForkThreadParams {
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, JsonValue | undefined> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  excludeTurns?: boolean;
  persistExtendedHistory?: boolean;
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
  modelProviders?: string[] | null;
  sourceKinds?: string[] | null;
  archived?: boolean | null;
  cwd?: string | null;
  searchTerm?: string | null;
}

export interface ListLoadedThreadsParams {
  cursor?: string | null;
  limit?: number | null;
}

export interface ThreadTurnsListParams {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
  sortDirection?: SortDirection | null;
}

export interface StartTurnParams {
  threadId: string;
  input: TurnInput[];
  cwd?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  summary?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  sandboxPolicy?: SandboxPolicy | null;
  personality?: Personality | null;
  outputSchema?: JsonValue | null;
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

export interface SkillsListExtraRootsForCwd {
  cwd: string;
  extraUserRoots: string[];
}

export interface SkillsListParams {
  cwds?: string[];
  forceReload?: boolean;
  perCwdExtraUserRoots?: SkillsListExtraRootsForCwd[] | null;
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

export interface ThreadResponse {
  thread: Thread;
}

export interface ThreadResumeResponse extends ThreadResponse {
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  cwd?: string;
  instructionSources?: string[];
  approvalPolicy?: ApprovalPolicy;
  sandbox?: SandboxPolicy;
  reasoningEffort?: ReasoningEffort | null;
}

export type ThreadForkResponse = ThreadResumeResponse;

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

export interface CodexClientOptions {
  clientName?: string;
  clientTitle?: string;
  clientVersion?: string;
  model?: string;
  cwd?: string;
  approvalPolicy?: "never" | "untrusted" | "on-failure" | "on-request";
  sandbox?: SandboxMode;
  experimentalApi?: boolean;
  optOutNotificationMethods?: string[];
  codexPath?: string;
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

export interface InitializeCapabilities {
  experimentalApi: boolean;
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
}

export interface CodexClientRequestMap {
  initialize: {
    params: InitializeParams;
    result: InitializeResponse;
  };
  "thread/start": {
    params: StartThreadParams;
    result: ThreadResponse;
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
  "item:agentMessage:delta": [{ itemId: string; delta: string }];
  "item:agentMessage:delta:notification": [AgentMessageDeltaNotification];
  "item:commandExecution:outputDelta": [{ itemId: string; delta: string }];
  "item:commandExecution:outputDelta:notification": [CommandOutputDeltaNotification];
  "command:exec:outputDelta": [CommandExecOutputDeltaNotification];
  "turn:diff:updated": [DiffUpdatedNotification];
  "turn:diff:updated:notification": [DiffUpdatedNotification];
  "turn:plan:updated": [PlanUpdatedNotification];
  "turn:plan:updated:notification": [PlanUpdatedNotification];
  "turn:plan:delta": [PlanDeltaNotification];
  "turn:plan:delta:notification": [PlanDeltaNotification];
  "thread:started": [Thread];
  "thread:status:changed": [ThreadStatusChangedNotification];
  "thread:archived": [ThreadLifecycleNotification];
  "thread:unarchived": [ThreadLifecycleNotification];
  "thread:closed": [ThreadLifecycleNotification];
  "thread:name:updated": [ThreadNameUpdatedNotification];
  "app:list:updated": [AppListUpdatedNotification];
  "serverRequest:resolved": [ServerRequestResolvedNotification];
  "skills:changed": [];
  "request:userInput": [ToolRequestUserInputParams & { requestId: RequestId }];
  "server:request": [JsonRpcRequest];
}
