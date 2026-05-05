# Codex App Client

TypeScript client for the [Codex App Server](https://developers.openai.com/codex/app-server/) stdio JSON-RPC protocol.

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
  model: "gpt-5.3-codex",
  cwd: "/path/to/your/repo",
  approvalPolicy: "never",
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

| Method                                | Description                                                     | Key Params                                   | Return Type                  |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| `connect()`                           | Spawn the app-server and complete the initialize handshake      | —                                            | `Promise<void>`              |
| `disconnect()`                        | Close the transport and kill the app-server process             | —                                            | `Promise<void>`              |
| `startThread(params)`                 | Create a new thread                                             | `StartThreadParams`                          | `Promise<Thread>`            |
| `resumeThread(threadId, params?)`     | Resume an existing thread                                       | `threadId: string`, `ResumeThreadParams?`    | `Promise<Thread>`            |
| `forkThread(threadId)`                | Fork a thread into a new copy                                   | `threadId: string`                           | `Promise<Thread>`            |
| `readThread(threadId, includeTurns?)` | Read thread metadata (optionally with turn history)             | `threadId: string`, `includeTurns?: boolean` | `Promise<Thread>`            |
| `listThreads(params?)`                | List threads with optional cursor pagination                    | `ListThreadsParams?`                         | `Promise<ThreadListResult>`  |
| `archiveThread(threadId)`             | Archive a thread                                                | `threadId: string`                           | `Promise<void>`              |
| `compactThread(threadId)`             | Compact a thread's history                                      | `threadId: string`                           | `Promise<void>`              |
| `startTurn(params)`                   | Start a turn and return immediately (non-blocking)              | `StartTurnParams`                            | `Promise<Turn>`              |
| `runTurn(params)`                     | Start a turn and wait for full completion, collecting all items | `StartTurnParams`                            | `Promise<CompletedTurn>`     |
| `steerTurn(params)`                   | Steer an in-progress turn with new input                        | `SteerTurnParams`                            | `Promise<string>` (turnId)   |
| `interruptTurn(threadId, turnId)`     | Interrupt an in-progress turn                                   | `threadId: string`, `turnId: string`         | `Promise<void>`              |
| `startReview(params)`                 | Start a code review turn                                        | `StartReviewParams`                          | `Promise<ReviewResult>`      |
| `runReview(params)`                   | Start a review and wait for completion                          | `StartReviewParams`                          | `Promise<CompletedReview>`   |
| `listModels(params?)`                 | List available models                                           | `ListModelsParams?`                          | `Promise<ModelListResult>`   |
| `execCommand(params)`                 | Execute a sandboxed shell command (no thread)                   | `ExecCommandParams`                          | `Promise<ExecCommandResult>` |

## Events

| Event                                            | Payload                                                    | Description                                               |
| ------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------- |
| `turn:started`                                   | `Turn`                                                     | A new turn began                                          |
| `turn:started:notification`                      | `TurnStartedNotification`                                  | A new turn began, including thread context                |
| `turn:completed`                                 | `Turn`                                                     | A turn finished (check `turn.status`)                     |
| `turn:completed:notification`                    | `TurnCompletedNotification`                                | A turn finished, including thread context                 |
| `item:started`                                   | `ThreadItem`                                               | An item (message, command, file change, etc.) began       |
| `item:started:notification`                      | `ItemNotification`                                         | An item began, including thread and turn context          |
| `item:completed`                                 | `ThreadItem`                                               | An item finished                                          |
| `item:completed:notification`                    | `ItemNotification`                                         | An item finished, including thread and turn context       |
| `item:agentMessage:delta`                        | `{ itemId: string; delta: string }`                        | Streaming text chunk from the agent                       |
| `item:agentMessage:delta:notification`           | `AgentMessageDeltaNotification`                            | Streaming text chunk with thread and turn context         |
| `item:commandExecution:outputDelta`              | `{ itemId: string; delta: string }`                        | Streaming output from a command                           |
| `item:commandExecution:outputDelta:notification` | `CommandOutputDeltaNotification`                           | Streaming command output with thread and turn context     |
| `turn:diff:updated`                              | `{ threadId: string; turnId: string; diff: string }`       | Cumulative diff for the current turn                      |
| `turn:diff:updated:notification`                 | `DiffUpdatedNotification`                                  | Cumulative diff notification                              |
| `turn:plan:updated`                              | `{ threadId?: string; turnId: string; plan: PlanEntry[] }` | Agent plan updated                                        |
| `turn:plan:updated:notification`                 | `PlanUpdatedNotification`                                  | Agent plan update notification                            |
| `turn:plan:delta`                                | `PlanDeltaNotification`                                    | Streaming plan text delta                                 |
| `turn:plan:delta:notification`                   | `PlanDeltaNotification`                                    | Streaming plan text delta notification                    |
| `thread:started`                                 | `Thread`                                                   | A new thread was created                                  |
| `error`                                          | `Error`                                                    | Transport-level error (process crash, socket close, etc.) |

## CodexClientOptions

| Field             | Type                                     | Default             | Description                                        |
| ----------------- | ---------------------------------------- | ------------------- | -------------------------------------------------- |
| `clientName`      | `string`                                 | `"openclaw"`        | Identifies this client in the initialize handshake |
| `clientVersion`   | `string`                                 | `"0.1.0"`           | Client version sent during initialize              |
| `model`           | `string`                                 | `"gpt-5.3-codex"`   | Default model for threads and turns                |
| `cwd`             | `string`                                 | `process.cwd()`     | Working directory for the spawned app-server       |
| `approvalPolicy`  | `"never" \| "unlessTrusted" \| "always"` | `"never"`           | When to ask for approval before running commands   |
| `sandbox`         | `string`                                 | `"workspace-write"` | Sandbox policy name                                |
| `experimentalApi` | `boolean`                                | `true`              | Enable experimental protocol features              |
| `codexPath`       | `string`                                 | `"codex"`           | Path to the `codex` binary                         |

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
client.on("item:agentMessage:delta", ({ text }) => process.stdout.write(text));
client.on("item:commandExecution:outputDelta", ({ output }) => process.stdout.write(output));

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

## Testing

```sh
bun test
```

Unit tests mock the transport layer. Integration tests (in `src/__tests__/integration.test.ts`) require a real `codex` binary and are automatically skipped when it is not available.
