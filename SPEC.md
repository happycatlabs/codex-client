# Codex App Server Client — Implementation Spec

## Overview

Build a TypeScript client library that wraps the `codex app-server` stdio protocol. The client spawns the app-server as a child process, communicates via JSON-RPC 2.0 over newline-delimited JSON (JSONL), and exposes a clean async API.

## Project Setup

- Runtime: Bun
- Entry point: `src/index.ts` (re-exports everything)
- Client implementation: `src/client.ts`
- Types: `src/types.ts`
- Tests: `src/__tests__/client.test.ts`

## Architecture

### Transport Layer (`src/transport.ts`)

Handles the raw JSON-RPC communication over stdio:

```ts
export class StdioTransport {
  readonly processInfo: CodexProcessInfo | undefined;

  constructor(private process: StdioProcess, options?: { detached?: boolean });

  send(message: JsonRpcMessage): void;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  close(): Promise<void>;
}
```

- Spawns `codex app-server` with piped stdin/stdout/stderr
- Supports opt-in detached process groups and reports `{ pid, pgid }` on POSIX (`pgid === pid` only when detached); Windows reports only `{ pid }`
- Reads stdout line-by-line, parses each line as JSON
- Writes to stdin as JSONL (JSON + newline)
- Tracks pending requests by `id` and resolves/rejects their promises when responses arrive
- Forwards notifications (no `id`) to registered notification handlers

### Client (`src/client.ts`)

High-level API wrapping the transport:

```ts
export class CodexClient extends EventEmitter {
  constructor(options?: CodexClientOptions);

  // Lifecycle
  readonly processInfo: CodexProcessInfo | undefined; // available while connected when transport owns a local child
  async connect(): Promise<void>; // spawns app-server, sends initialize + initialized
  async disconnect(): Promise<void>; // closes transport

  // Threads
  async startThread(params: StartThreadParams): Promise<Thread>;
  async resumeThread(threadId: string, params?: ResumeThreadParams): Promise<Thread>;
  async forkThread(threadId: string, params?: ForkThreadParams): Promise<Thread>;
  async readThread(threadId: string, includeTurns?: boolean): Promise<Thread>; // includeTurns pages stored turn history
  async listThreads(params?: ListThreadsParams): Promise<ThreadListResult>;
  async listLoadedThreads(params?: ListLoadedThreadsParams): Promise<ThreadLoadedListResult>;
  async listThreadTurns(params: ThreadTurnsListParams): Promise<ThreadTurnsListResult>; // experimental
  async listThreadItems(params: ThreadItemsListParams): Promise<ThreadItemsListResult>; // experimental
  /** @deprecated Use listThreadItems(). */
  async listThreadTurnItems(params: ThreadTurnsItemsListParams): Promise<ThreadTurnsItemsListResult>;
  async archiveThread(threadId: string): Promise<void>;
  async unarchiveThread(threadId: string): Promise<Thread>;
  async deleteThread(threadId: string): Promise<void>;
  async unsubscribeThread(threadId: string): Promise<ThreadUnsubscribeResult>;
  async setThreadName(threadId: string, name: string): Promise<void>;
  async compactThread(threadId: string): Promise<void>;
  /** @deprecated thread/rollback is deprecated upstream; prefer forkThread with lastTurnId. */
  async rollbackThread(threadId: string, numTurns: number): Promise<Thread>;

  // Turns
  async startTurn(params: StartTurnParams): Promise<Turn>;
  async steerTurn(params: SteerTurnParams): Promise<string>; // returns turnId
  async interruptTurn(threadId: string, turnId: string): Promise<void>;

  // Review
  async startReview(params: StartReviewParams): Promise<ReviewResult>;

  // Models
  async listModels(params?: ListModelsParams): Promise<ModelListResult>;
  async listCollaborationModes(): Promise<CollaborationModeListResult>; // experimental

  // Command execution (sandboxed, no thread)
  async execCommand(params: ExecCommandParams): Promise<ExecCommandResult>;
}
```

### Options

```ts
interface CodexClientOptions {
  clientName?: string; // default: "openclaw"
  clientTitle?: string; // default: "OpenClaw"; follows a customized clientName when omitted
  clientVersion?: string; // default: "0.1.0"
  model?: string; // default: none — omitted from thread/start so the server uses the user's config default
  cwd?: string; // default: process.cwd()
  approvalPolicy?: "never" | "untrusted" | "on-request" | { granular: GranularApprovalPolicy }; // default: "never"
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"; // default: "workspace-write"
  experimentalApi?: boolean; // default: true
  requestAttestation?: boolean; // default: unset; opt into attestation/generate requests
  mcpServerOpenaiFormElicitation?: boolean; // default: unset; allow extended MCP form elicitations
  optOutNotificationMethods?: string[]; // default: []
  codexPath?: string; // default: "codex"
  detached?: boolean; // default: false; detached child leads its own POSIX process group
  spawnArgs?: string[]; // default: []; appended after the app-server subcommand
}
```

`processInfo.pgid` is available only for detached POSIX children. Windows has
detached-process semantics but no POSIX process-group id, so only `pid` is
reported there.

Note: `sandbox` on `thread/start` takes kebab-case `SandboxMode` strings
(`"workspace-write"`), while `sandboxPolicy` on `turn/start` takes a
`SandboxPolicy` object whose `type` tags are camelCase (`"workspaceWrite"`).

### Events (emitted by the client)

```ts
// Turn lifecycle
client.on("turn:started", (turn: Turn) => {});
client.on("turn:started:notification", (notification: TurnStartedNotification) => {});
client.on("turn:completed", (turn: Turn) => {});
client.on("turn:completed:notification", (notification: TurnCompletedNotification) => {});

// Item lifecycle
client.on("item:started", (item: ThreadItem) => {});
client.on("item:started:notification", (notification: ItemNotification) => {});
client.on("item:completed", (item: ThreadItem) => {});
client.on("item:completed:notification", (notification: ItemNotification) => {});

// Streaming
client.on("item:agentMessage:delta", (delta: { itemId: string; delta: string }) => {});
client.on("item:agentMessage:delta:notification", (notification: AgentMessageDeltaNotification) => {});
client.on("item:commandExecution:outputDelta", (delta: { itemId: string; delta: string }) => {});
client.on("item:commandExecution:outputDelta:notification", (notification: CommandOutputDeltaNotification) => {});
client.on("item:mcpToolCall:progress", (progress: { itemId: string; message: string }) => {});
client.on("item:mcpToolCall:progress:notification", (notification: McpToolCallProgressNotification) => {});

// Diff
client.on("turn:diff:updated", (data: { threadId: string; turnId: string; diff: string }) => {});
client.on("turn:diff:updated:notification", (notification: DiffUpdatedNotification) => {});

// Plan
client.on("turn:plan:updated", (data: { threadId?: string; turnId: string; plan: PlanEntry[] }) => {});
client.on("turn:plan:updated:notification", (notification: PlanUpdatedNotification) => {});
client.on("item:plan:delta", (notification: PlanDeltaNotification) => {}); // wire method: item/plan/delta
// turn:plan:delta and turn:plan:delta:notification remain as deprecated aliases of item:plan:delta

// Diagnostics
client.on("turn:error", (notification: ErrorNotification) => {}); // mid-turn errors, incl. willRetry
client.on("model:rerouted", (notification: ModelReroutedNotification) => {});
client.on("deprecationNotice", (notification: DeprecationNoticeNotification) => {});
client.on("warning", (notification: WarningNotification) => {});
client.on("notification", (message: JsonRpcNotification) => {}); // every server notification, raw

// Thread
client.on("thread:started", (thread: Thread) => {});
client.on("thread:deleted", (notification: ThreadLifecycleNotification) => {});
client.on("thread:compacted", (notification: ThreadCompactedNotification) => {});
client.on("thread:tokenUsage:updated", (notification: ThreadTokenUsageUpdatedNotification) => {});

// Approvals (server requests; respond via the matching respondTo* helper)
client.on("request:commandExecutionApproval", (params) => {});
client.on("request:fileChangeApproval", (params) => {});
client.on("request:permissionsApproval", (params) => {});
```

### Turn Helper — `runTurn()`

A convenience method that starts a turn and waits for completion, collecting all items:

```ts
async runTurn(params: StartTurnParams): Promise<CompletedTurn> {
  // 1. Start the turn
  // 2. Collect all item:completed events for this turn
  // 3. Wait for turn:completed
  // 4. Reconcile terminal summary items by item ID
  // 5. Return { turn, items, agentMessage, diff }
}
```

This is what we'll use most often — fire a task and get back the full result.
Successful Codex 0.146+ completions can include the final agent message in
`turn.items` with `itemsView: "summary"` so clients can recover from dropped
item notifications. `runTurn()` appends missing terminal items and replaces
matching collected items with the authoritative terminal version, preserving
one result entry per item ID.

### Review Helper — `runReview()`

Similar convenience for reviews:

```ts
async runReview(params: StartReviewParams): Promise<CompletedReview> {
  // 1. Start the review
  // 2. Collect enteredReviewMode and exitedReviewMode items
  // 3. Wait for turn:completed
  // 4. Fall back to the terminal agent-message summary when review items were dropped
  // 5. Return { turn, reviewText }
}
```

## Types (`src/types.ts`)

Define all the types from the protocol spec. Key ones:

```ts
// JSON-RPC
interface JsonRpcRequest {
  method: string;
  id: number;
  params?: unknown;
}
interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}
interface JsonRpcNotification {
  method: string;
  params?: unknown;
}
interface JsonRpcError {
  code: number;
  message: string;
}

// Thread
interface Thread {
  id: string;
  sessionId?: string;
  preview?: string;
  modelProvider?: string;
  createdAt?: number;
  updatedAt?: number;
  threadSource?: "user" | "subagent" | "memory_consolidation" | null;
}

// Turn
interface Turn {
  id: string;
  status: "inProgress" | "completed" | "interrupted" | "failed";
  items: ThreadItem[];
  error?: TurnError;
}
interface TurnError {
  message: string;
  codexErrorInfo?: CodexErrorInfo | null; // e.g. "usageLimitExceeded", "unauthorized", { httpConnectionFailed: {...} }
  additionalDetails?: string | null;
}

// Items (simplified union)
type ThreadItem =
  | { type: "userMessage"; id: string; content: unknown[] }
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd?: string;
      status: string;
      exitCode?: number;
      aggregatedOutput?: string;
    }
  | { type: "fileChange"; id: string; changes: FileChange[]; status: string }
  | { type: "mcpToolCall"; id: string; server: string; tool: string; status: string; arguments: JsonValue }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      status: string;
      arguments: JsonValue;
    }
  | {
      type: "collabAgentToolCall";
      id: string;
      tool: string;
      status: string;
      senderThreadId: string;
      receiverThreadIds: string[];
    }
  | { type: "webSearch"; id: string; query: string; action: WebSearchAction | null }
  | { type: "hookPrompt"; id: string; fragments: HookPromptFragment[] }
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "reasoning"; id: string; summary?: unknown; content?: unknown }
  | { type: "plan"; id: string; text: string }
  | { type: string; id: string; [key: string]: unknown }; // catch-all

interface FileChange {
  path: string;
  kind: string;
  diff: string;
}

// Params
type ApprovalPolicy = "never" | "untrusted" | "on-request" | { granular: GranularApprovalPolicy };

interface StartThreadParams {
  model?: string; // omit to use the server-side config default
  cwd?: string;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: "user" | "auto_review" | "guardian_subagent" | null;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  personality?: string;
  sessionStartSource?: "startup" | "clear" | null;
  threadSource?: "user" | "subagent" | "memory_consolidation" | null;
}
interface ResumeThreadParams {
  approvalsReviewer?: "user" | "auto_review" | "guardian_subagent" | null;
  personality?: string;
}
interface ForkThreadParams {
  lastTurnId?: string | null; // fork through this turn, inclusive
  threadSource?: "user" | "subagent" | "memory_consolidation" | null;
}
interface ListThreadsParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: "created_at" | "updated_at" | string | null;
  sortDirection?: "asc" | "desc" | null;
  modelProviders?: string[] | null;
  sourceKinds?: string[] | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
  useStateDbOnly?: boolean;
  searchTerm?: string | null;
}
interface StartTurnParams {
  threadId: string;
  input: TurnInput[];
  clientUserMessageId?: string; // echoed back as clientId on the userMessage item
  cwd?: string;
  model?: string;
  effort?: string;
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: "user" | "auto_review" | "guardian_subagent" | null;
  sandboxPolicy?: SandboxPolicy;
  collaborationMode?: CollaborationMode | null; // experimental
}
interface SteerTurnParams {
  threadId: string;
  input: TurnInput[];
  expectedTurnId: string;
}
interface StartReviewParams {
  threadId: string;
  delivery?: "inline" | "detached";
  target: ReviewTarget;
}

type TurnInput =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };
type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string | null }
  | { type: "custom"; instructions: string };

interface SandboxPolicy {
  type: string;
  writableRoots?: string[];
  networkAccess?: boolean;
}

// Results
interface CompletedTurn {
  turn: Turn;
  items: ThreadItem[];
  agentMessage: string;
  diff?: string;
}
interface CompletedReview {
  turn: Turn;
  reviewText: string;
}
interface ModelListResult {
  data: ModelInfo[];
  nextCursor?: string | null;
}
interface ModelInfo {
  id: string;
  model: string;
  displayName: string;
  additionalSpeedTiers?: string[];
  serviceTiers?: { id: string; name: string; description: string }[];
  isDefault?: boolean;
}
interface ThreadListResult {
  data: Thread[];
  nextCursor?: string | null;
}
interface ThreadStartResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
  instructionSources: string[];
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer: "user" | "auto_review" | "guardian_subagent";
  sandbox: SandboxPolicy;
  reasoningEffort: string | null;
}
interface ThreadResumeResponse extends ThreadStartResponse {
  initialTurnsPage?: ThreadTurnsListResult | null; // experimental, when requested
}
type ThreadForkResponse = ThreadStartResponse;
interface ExecCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
```

## Request ID Management

Use an auto-incrementing counter starting at 0. The initialize handshake uses id=0.

## Error Handling

- If the app-server process exits unexpectedly, reject all pending requests and emit an `error` event
- If a request times out (default 5 minutes for turns, 30s for others), reject with a timeout error
- If a JSON-RPC error response comes back, reject the pending promise with the error message
- If `turn/completed` has `status: "failed"`, the `runTurn()` helper should reject with the error message

## Tests (`src/__tests__/client.test.ts`)

### Unit tests (mock the transport):

1. **initialize handshake** — connect() sends initialize + initialized, resolves on success
2. **startThread** — sends thread/start, returns Thread from response
3. **resumeThread** — sends thread/resume with threadId
4. **startTurn** — sends turn/start, returns Turn
5. **runTurn collects items** — mock a sequence: turn/started → item/started → item/agentMessage/delta → item/completed → turn/completed → verify CompletedTurn has everything
6. **steerTurn** — sends turn/steer with expectedTurnId
7. **interruptTurn** — sends turn/interrupt
8. **error response rejects** — JSON-RPC error response rejects the pending promise
9. **process exit rejects pending** — transport close rejects all pending requests
10. **detached spawn forwarding** — default false and opt-in true reach Bun.spawn
11. **process identity** — transport/client expose valid PID/PGID, omit PGID on Windows, and return undefined when unavailable
12. **experimental history APIs** — turn paging uses `thread/turns/list`; item paging preserves stable bare items and Codex 0.145+ `{ turnId, item }` entries, while the deprecated one-turn helper unwraps entries back to bare items; both item helpers use `thread/items/list`
13. **collaboration modes** — presets use `collaborationMode/list` and turn params preserve `collaborationMode`
14. **thread lifecycle response typing** — start/resume/fork request results expose all current stable response metadata

### Integration test (real app-server, guarded):

Only run if `codex` binary is available. Skip with a message if not.

1. **connect and list models** — spawn real app-server, connect, list models, disconnect
2. **start thread and run a simple turn** — start thread, run turn with "echo hello world", wait for completion, verify agent message exists

These integration tests should be in a separate file: `src/__tests__/integration.test.ts`

## File Structure

```
src/
  index.ts          — re-exports: CodexClient, types
  client.ts         — CodexClient class
  transport.ts      — StdioTransport (stdio JSON-RPC)
  types.ts          — all TypeScript types
  __tests__/
    client.test.ts       — unit tests with mocked transport
    integration.test.ts  — real app-server tests (guarded)
```

## Constraints

- TypeScript strict mode
- No `any` — use `unknown` and narrow
- ESM with `.js` imports (Bun convention — actually Bun resolves .ts, so no .js needed)
- No external dependencies beyond what Bun provides
- `bun test` must pass
- Export the client as both named and default export

## Commit

Single commit: `feat: codex app-server client with thread persistence, review, and streaming`
