# Codex App Client

TypeScript client for the [Codex App Server](https://developers.openai.com/codex/app-server/) stdio JSON-RPC protocol.

Protocol types are kept aligned with the official app-server docs and the installed Codex CLI schema generator:

```sh
codex app-server generate-ts --out ./schemas
```

## Install

```sh
npm install @happycatlabs/codex-client
# or
bun add @happycatlabs/codex-client
```

## Quick Start

```ts
import { CodexClient } from "@happycatlabs/codex-client";

const client = new CodexClient({
  cwd: "/path/to/your/repo",
  approvalPolicy: "never",
  // model is optional — when omitted the server uses the user's config default
});

await client.connect();

const thread = await client.startThread({});

const result = await client.runTurn({
  threadId: thread.id,
  input: [{ type: "text", text: "List all TypeScript files in src/" }],
});

console.log(result.agentMessage);

await client.disconnect();
```

## API Reference

| Method                                | Description                                                     | Key Params                                   | Return Type                            |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- |
| `connect()`                           | Spawn the app-server and complete the initialize handshake      | —                                            | `Promise<void>`                        |
| `disconnect()`                        | Close the transport and kill the app-server process             | —                                            | `Promise<void>`                        |
| `processInfo`                         | Read local app-server PID/PGID identity while connected         | —                                            | `CodexProcessInfo \| undefined`        |
| `startThread(params)`                 | Create a new thread                                             | `StartThreadParams`                          | `Promise<Thread>`                      |
| `resumeThread(threadId, params?)`     | Resume an existing thread                                       | `threadId: string`, `ResumeThreadParams?`    | `Promise<Thread>`                      |
| `forkThread(threadId, params?)`       | Fork a thread (optionally through a specific `lastTurnId`)      | `threadId: string`, `ForkThreadParams?`      | `Promise<Thread>`                      |
| `readThread(threadId, includeTurns?)` | Read thread metadata (optionally with turn history)             | `threadId: string`, `includeTurns?: boolean` | `Promise<Thread>`                      |
| `listThreads(params?)`                | List threads with optional cursor pagination                    | `ListThreadsParams?`                         | `Promise<ThreadListResult>`            |
| `listLoadedThreads(params?)`          | List thread ids currently loaded by app-server                  | `ListLoadedThreadsParams?`                   | `Promise<ThreadLoadedListResult>`      |
| `listThreadTurns(params)`             | Page stored turns without resuming (experimental)               | `ThreadTurnsListParams`                      | `Promise<ThreadTurnsListResult>`       |
| `listThreadItems(params)`             | Page stored items across stable and 0.145+ wire shapes          | `ThreadItemsListParams`                      | `Promise<ThreadItemsListResult>`       |
| `listThreadTurnItems(params)`         | Deprecated one-turn alias that returns bare items               | `ThreadTurnsItemsListParams`                 | `Promise<ThreadTurnsItemsListResult>`  |
| `archiveThread(threadId)`             | Archive a thread                                                | `threadId: string`                           | `Promise<void>`                        |
| `deleteThread(threadId)`              | Permanently delete a thread                                     | `threadId: string`                           | `Promise<void>`                        |
| `compactThread(threadId)`             | Compact a thread's history                                      | `threadId: string`                           | `Promise<void>`                        |
| `rollbackThread(threadId, numTurns)`  | Deprecated upstream — prefer `forkThread` with `lastTurnId`     | `threadId: string`, `numTurns: number`       | `Promise<Thread>`                      |
| `startTurn(params)`                   | Start a turn and return immediately (non-blocking)              | `StartTurnParams`                            | `Promise<Turn>`                        |
| `runTurn(params)`                     | Start a turn and wait for full completion, collecting all items | `StartTurnParams`                            | `Promise<CompletedTurn>`               |
| `steerTurn(params)`                   | Steer an in-progress turn with new input                        | `SteerTurnParams`                            | `Promise<string>` (turnId)             |
| `interruptTurn(threadId, turnId)`     | Interrupt an in-progress turn                                   | `threadId: string`, `turnId: string`         | `Promise<void>`                        |
| `startReview(params)`                 | Start a code review turn                                        | `StartReviewParams`                          | `Promise<ReviewResult>`                |
| `runReview(params)`                   | Start a review and wait for completion                          | `StartReviewParams`                          | `Promise<CompletedReview>`             |
| `listModels(params?)`                 | List available models                                           | `ListModelsParams?`                          | `Promise<ModelListResult>`             |
| `listCollaborationModes()`            | List collaboration-mode presets (experimental)                  | —                                            | `Promise<CollaborationModeListResult>` |
| `execCommand(params)`                 | Execute a sandboxed shell command (no thread)                   | `ExecCommandParams`                          | `Promise<ExecCommandResult>`           |

Recent Codex app-server fields are exposed on the matching params/types:
`approvalsReviewer`, `sessionStartSource`, `threadSource`, array-valued
`listThreads.cwd`, `listThreads.useStateDbOnly`, model `serviceTiers`,
`StartTurnParams.clientUserMessageId` (echoed back as the `userMessage` item's
`clientId`), `StartTurnParams.collaborationMode`, and
`ForkThreadParams.lastTurnId`. Experimental thread-history methods stay typed
even though the stable generated `ClientRequest` union omits experimental RPCs.

## Events

| Event                                            | Payload                                                    | Description                                                          |
| ------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `turn:started`                                   | `Turn`                                                     | A new turn began                                                     |
| `turn:started:notification`                      | `TurnStartedNotification`                                  | A new turn began, including thread context                           |
| `turn:completed`                                 | `Turn`                                                     | A turn finished (check `turn.status`)                                |
| `turn:completed:notification`                    | `TurnCompletedNotification`                                | A turn finished, including thread context                            |
| `item:started`                                   | `ThreadItem`                                               | An item (message, command, file change, etc.) began                  |
| `item:started:notification`                      | `ItemNotification`                                         | An item began, including thread and turn context                     |
| `item:completed`                                 | `ThreadItem`                                               | An item finished                                                     |
| `item:completed:notification`                    | `ItemNotification`                                         | An item finished, including thread and turn context                  |
| `rawResponseItem:completed`                      | `ResponseItem`                                             | A raw Responses API item finished                                    |
| `rawResponseItem:completed:notification`         | `RawResponseItemCompletedNotification`                     | A raw Responses API item finished with thread context                |
| `item:agentMessage:delta`                        | `{ itemId: string; delta: string }`                        | Streaming text chunk from the agent                                  |
| `item:agentMessage:delta:notification`           | `AgentMessageDeltaNotification`                            | Streaming text chunk with thread and turn context                    |
| `item:commandExecution:outputDelta`              | `{ itemId: string; delta: string }`                        | Streaming output from a command                                      |
| `item:commandExecution:outputDelta:notification` | `CommandOutputDeltaNotification`                           | Streaming command output with thread and turn context                |
| `item:mcpToolCall:progress`                      | `{ itemId: string; message: string }`                      | Streaming progress from an MCP tool call                             |
| `item:mcpToolCall:progress:notification`         | `McpToolCallProgressNotification`                          | Streaming MCP progress with thread and turn context                  |
| `turn:diff:updated`                              | `{ threadId: string; turnId: string; diff: string }`       | Cumulative diff for the current turn                                 |
| `turn:diff:updated:notification`                 | `DiffUpdatedNotification`                                  | Cumulative diff notification                                         |
| `turn:plan:updated`                              | `{ threadId?: string; turnId: string; plan: PlanEntry[] }` | Agent plan updated                                                   |
| `turn:plan:updated:notification`                 | `PlanUpdatedNotification`                                  | Agent plan update notification                                       |
| `item:plan:delta`                                | `PlanDeltaNotification`                                    | Streaming plan text delta (wire method `item/plan/delta`)            |
| `turn:plan:delta`                                | `PlanDeltaNotification`                                    | Deprecated alias of `item:plan:delta`                                |
| `turn:plan:delta:notification`                   | `PlanDeltaNotification`                                    | Deprecated alias of `item:plan:delta`                                |
| `turn:error`                                     | `ErrorNotification`                                        | Mid-turn error from the server, incl. `willRetry` + `codexErrorInfo` |
| `thread:started`                                 | `Thread`                                                   | A new thread was created                                             |
| `thread:status:changed`                          | `ThreadStatusChangedNotification`                          | Loaded thread runtime status changed                                 |
| `thread:deleted`                                 | `ThreadLifecycleNotification`                              | A thread was deleted                                                 |
| `thread:compacted`                               | `ThreadCompactedNotification`                              | Thread history was compacted                                         |
| `thread:tokenUsage:updated`                      | `ThreadTokenUsageUpdatedNotification`                      | Token usage / context-window tracking for a thread                   |
| `model:rerouted`                                 | `ModelReroutedNotification`                                | Server rerouted the turn to a different model                        |
| `deprecationNotice`                              | `DeprecationNoticeNotification`                            | Server flags a deprecated API this client used                       |
| `warning`                                        | `WarningNotification`                                      | Server warning, optionally scoped to a thread                        |
| `request:userInput`                              | `ToolRequestUserInputParams & { requestId }`               | Server asks questions; answer via `respondToUserInputRequest()`      |
| `request:commandExecutionApproval`               | `CommandExecutionRequestApprovalParams & { requestId }`    | Command approval; answer via `respondToCommandExecutionApproval()`   |
| `request:fileChangeApproval`                     | `FileChangeRequestApprovalParams & { requestId }`          | File-change approval; answer via `respondToFileChangeApproval()`     |
| `request:permissionsApproval`                    | `PermissionsRequestApprovalParams & { requestId }`         | Permission grant; answer via `respondToPermissionsApproval()`        |
| `notification`                                   | `JsonRpcNotification`                                      | Every server notification, raw — unknown methods stay observable     |
| `error`                                          | `Error`                                                    | Transport-level error (process crash, socket close, etc.)            |

## CodexClientOptions

| Field                            | Type                                                        | Default             | Description                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientName`                     | `string`                                                    | `"openclaw"`        | Identifies this client in the initialize handshake                                                                                                                                                                       |
| `clientTitle`                    | `string`                                                    | `"OpenClaw"`        | Display title sent during initialize; when only `clientName` is customized, that name is also used as the title                                                                                                          |
| `clientVersion`                  | `string`                                                    | `"0.1.0"`           | Client version sent during initialize                                                                                                                                                                                    |
| `model`                          | `string`                                                    | _(unset)_           | Default model for threads. When unset, `thread/start` omits `model` and the server uses the user's config default (`model` in `~/.codex/config.toml`). Use `listModels()` + `isDefault` to discover the catalog default. |
| `cwd`                            | `string`                                                    | `process.cwd()`     | Working directory for the spawned app-server                                                                                                                                                                             |
| `approvalPolicy`                 | `"never" \| "untrusted" \| "on-request" \| { granular: … }` | `"never"`           | When to ask for approval before running commands                                                                                                                                                                         |
| `sandbox`                        | `"read-only" \| "workspace-write" \| "danger-full-access"`  | `"workspace-write"` | Sandbox mode name (kebab-case)                                                                                                                                                                                           |
| `experimentalApi`                | `boolean`                                                   | `true`              | Enable experimental protocol features                                                                                                                                                                                    |
| `requestAttestation`             | `boolean`                                                   | _(unset)_           | Opt into `attestation/generate` server requests in initialize capabilities                                                                                                                                               |
| `mcpServerOpenaiFormElicitation` | `boolean`                                                   | _(unset)_           | Allow downstream MCP servers to request OpenAI extended form elicitations                                                                                                                                                |
| `optOutNotificationMethods`      | `string[]`                                                  | `[]`                | Notification method names the client asks app-server not to send                                                                                                                                                         |
| `codexPath`                      | `string`                                                    | `"codex"`           | Path to the `codex` binary                                                                                                                                                                                               |
| `detached`                       | `boolean`                                                   | `false`             | Spawn app-server detached. On POSIX it leads its own process group; Windows has detached-process semantics but no POSIX PGID                                                                                             |
| `spawnArgs`                      | `string[]`                                                  | `[]`                | Extra CLI args appended after `app-server` (e.g. `["proxy"]` to attach to a shared `codex app-server daemon`, or `["-c", "key=value"]`)                                                                                  |

Consumers that need process-group lifecycle control can opt in and read the
identity after connection. On POSIX, a detached child reports `pgid === pid`;
on Windows, `pgid` remains undefined. The client exposes identity only; it does
not send signals on the consumer's behalf.

```ts
const client = new CodexClient({ detached: true });
await client.connect();

const processInfo = client.processInfo; // { pid, pgid } on POSIX; { pid } on Windows
```

## `runTurn()` vs `startTurn()`

**Use `runTurn()`** when you want fire-and-forget behavior: send input, wait for the agent to finish, get back the full result including all items, the final agent message, and the cumulative diff. This covers the vast majority of use cases.

```ts
const { agentMessage, items, diff } = await client.runTurn({
  threadId: thread.id,
  input: [{ type: "text", text: "Refactor this function" }],
});
```

**Use `startTurn()`** when you need to react to streaming events while the turn is in progress — for example, to pipe `item:agentMessage:delta` events to a UI in real time, or to conditionally steer/interrupt the turn based on what the agent is doing.

```ts
client.on("item:agentMessage:delta", ({ delta }) => process.stdout.write(delta));
client.on("item:commandExecution:outputDelta", ({ delta }) => process.stdout.write(delta));

const turn = await client.startTurn({
  threadId: thread.id,
  input: [{ type: "text", text: "Run the tests" }],
});

// turn is in progress — listen to events, steer or interrupt if needed
// Wait manually:
await new Promise<void>((resolve) => {
  client.once("turn:completed", (t) => {
    if (t.id === turn.id) resolve();
  });
});
```

## Large Thread History

Use `readThread(threadId, true)` when loading the entire stored history is
reasonable:

```ts
const thread = await client.readThread(threadId, true);
for (const turn of thread.turns ?? []) {
  // turn.itemsView is "notLoaded" | "summary" | "full"
  console.log(turn.id, turn.status, turn.items.length);
}
```

For large histories, use the experimental paging methods. They require
`experimentalApi: true` (the client default):

```ts
const turns = await client.listThreadTurns({
  threadId,
  limit: 50,
  sortDirection: "desc",
  itemsView: "summary",
});

const items = await client.listThreadItems({
  threadId,
  turnId: turns.data[0]?.id, // omit to page items across the whole thread
  limit: 100,
  sortDirection: "asc",
});

for (const entry of items.data) {
  const item = "item" in entry ? entry.item : entry;
  const containingTurnId = "item" in entry ? entry.turnId : undefined;
  console.log(containingTurnId, item.type);
}
```

The current item RPC is `thread/items/list`. Stable servers return bare
`ThreadItem` values, while Codex 0.145+ returns `{ turnId, item }` envelopes.
`listThreadItems()` preserves both as the explicit `ThreadItemsListEntry` union
instead of inventing turn ids for legacy pages. `listThreadTurnItems()` remains
a deprecated source-compatible alias for consumers of the former one-turn
helper; it sends the current wire method and unwraps 0.145+ entries back to
bare items. `thread/turns/list` and
`collaborationMode/list` are also live experimental methods in codex-cli
`0.144.1`; they are intentionally retained even though stable generated
bindings filter experimental RPCs from the `ClientRequest` union.

## Approvals

When `approvalPolicy` is anything other than `"never"`, the server sends
approval requests mid-turn. Each surfaces as a typed event carrying a
`requestId`; reply with the matching helper:

```ts
client.on("request:commandExecutionApproval", (params) => {
  console.log(`approve? ${params.command} (cwd: ${params.cwd})`);
  client.respondToCommandExecutionApproval(params.requestId, "accept");
});

client.on("request:fileChangeApproval", (params) => {
  client.respondToFileChangeApproval(params.requestId, "decline");
});

client.on("request:permissionsApproval", (params) => {
  client.respondToPermissionsApproval(params.requestId, {
    permissions: {},
    scope: "turn",
  });
});
```

Decisions are `"accept" | "acceptForSession" | "decline" | "cancel"` (command
execution additionally supports execpolicy/network-policy amendment objects).

## Testing

```sh
bun test
```

Unit tests mock the transport layer. Integration tests (in `src/__tests__/integration.test.ts`) require a real `codex` binary and are automatically skipped when it is not available.
