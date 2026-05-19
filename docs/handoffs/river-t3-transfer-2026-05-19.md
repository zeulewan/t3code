# River T3 Transfer - 2026-05-19

This is the operational handoff from the Codex River session into a new T3-managed River agent.

The goal is not to replay every transcript line. The goal is to preserve enough project state that the new River can continue development safely from the same repo, same SQLite state, and same live T3 server.

## Identity

- New agent name: `river`
- Intended comms handle: `@river`
- Current working repo: `/home/zeul/GIT/t3code`
- Current branch: `main`
- Runtime base dir: `/home/zeul/.t3`
- Runtime DB: `/home/zeul/.t3/dev/state.sqlite`
- Live dev URL: `http://workstation.tailee9084.ts.net:5733`
- Tailnet app URL previously used by Zeul: `https://workstation.tailee9084.ts.net:13773/`

## Operating Rules

- Treat this repo as a dirty working tree. Do not reset or discard changes unless Zeul explicitly asks.
- Inspect before editing: run `git status --short`, read changed files, and understand the current diff.
- Use `bun run --filter t3 test -- src/bin.test.ts`, `bun run --filter t3 typecheck`, `bun run fmt:check`, and `git diff --check` before claiming backend CLI work is ready.
- Keep agent comms conversational content inside comms messages. Do not fill local thread transcripts with "Sent my direct reply..." chatter unless a human asks for status.
- When speaking as River, use first person. Handles are routing IDs, not personality text.

## Current Dirty Tree

Known modified files:

- `apps/desktop/src/settings/DesktopClientSettings.test.ts`
- `apps/server/src/bin.test.ts`
- `apps/server/src/bin.ts`
- `apps/server/src/cli/config.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/server.test.ts`
- `apps/server/src/server.ts`
- `apps/server/src/ws.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/rpc.ts`

Known new files:

- `apps/server/src/cli/agent.ts`
- `apps/server/src/cli/comms.ts`
- `apps/server/src/cli/orchestrationCli.ts`
- `apps/server/src/persistence/Layers/Comms.test.ts`
- `apps/server/src/persistence/Layers/Comms.ts`
- `apps/server/src/persistence/Migrations/031_Comms.ts`
- `apps/server/src/persistence/Services/Comms.ts`
- `docs/interagent-comms.md`
- `docs/handoffs/river-t3-transfer-2026-05-19.md`
- `packages/contracts/src/comms.ts`

Recent commits on `main` at handoff time:

- `621fad61 Remove Git init control`
- `679ac077 Expand UI scale presets`
- `1f15d45a Add UI scale setting`
- `0edaa86f Add mobile long-press context menus`
- `6447cdf1 Add iOS standalone web app metadata`

## What Was Implemented

The current dirty tree contains the first backend-only iteration of inter-agent comms.

Implemented pieces:

- Durable SQL comms tables via migration `031_Comms`.
- Contract schemas in `packages/contracts/src/comms.ts`.
- Contract exports and RPC additions in `packages/contracts/src/index.ts` and `packages/contracts/src/rpc.ts`.
- `CommsRepository` service and SQLite layer.
- WebSocket RPC handlers for comms registration, actor list, send, and inbox reads.
- CLI command group `t3 comms`.
- CLI command group `t3 agent`.
- Documentation in `docs/interagent-comms.md`.

Current CLI commands:

- `t3 agent list`
- `t3 agent spawn`
- `t3 agent send`
- `t3 agent stop`
- `t3 agent rename`
- `t3 agent model`
- `t3 comms register`
- `t3 comms actors`
- `t3 comms send`
- `t3 comms inbox`

Because this is running from source, the dev command form is usually:

```bash
node apps/server/src/bin.ts --log-level error <command> --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Long term this should collapse into a short installed command such as:

```bash
t3 msg bob "message"
```

or a native provider tool such as:

```text
send_agent_message(to: "bob", type: "direct", body: "message")
```

## Current Comms Model

Core concepts:

- Actor: stable addressable identity, for example `@bob`, `@joe`, eventually `@river`.
- Thread: provider runtime and visible transcript.
- Conversation: comms container, currently `dm` or `group` shape in SQL.
- Message: immutable content in a conversation.
- Delivery: per-recipient delivery state.

Message types:

- `direct`: inject into the recipient thread as a user turn when live.
- `notify`: inject only a notification that inbox mail exists.
- `defer`: inbox only, no live injection.

Current behavior:

- Actor handles are global in the local DB.
- Cross-project messaging should work because `comms send` resolves recipients by global handle, not by project.
- The sender message's `project_id` is currently set from the sender's project.
- Handles are globally unique because `comms_actors.handle` has the conflict key.
- Renaming a sidebar thread title does not change the actor handle.

Important distinction:

- Thread/sidebar name lives in `projection_threads.title`.
- Comms identity lives in `comms_actors.handle` and `comms_actors.display_name`.
- `agent send`, `agent stop`, and `agent rename` can resolve a thread id, title, or comms handle.
- `comms send` only uses comms handles.

Recommended future behavior:

- Keep handles stable by default.
- Make display names renameable.
- Add explicit handle rename or alias support later, so old handles can keep working.
- Show both display name and handle in UI.

## Live Test Agents

Existing T3 test agents:

- `@bob`
  - Thread: `417d4e86-1055-41bd-8667-4bc1cf668e46`
  - Title: `bob`
  - Project: `77344f81-7405-415b-b7c5-a68f8063edf5`
  - Model: `codex/gpt-5.4`
- `@joe`
  - Thread: `7be84274-8faa-4d72-a078-c9bf28ed6893`
  - Title: `joe`
  - Project: `77344f81-7405-415b-b7c5-a68f8063edf5`
  - Model: `codex/gpt-5.4`

Both Bob and Joe were seeded with operating notes:

- Use the comms CLI when asked to message another agent.
- Use first person in their own character.
- Reply through comms when a direct comms message asks for a response.
- Keep local assistant acknowledgements minimal, usually `sent`, and do not duplicate the conversation content in local thread replies.

## Verified Behavior

Targeted checks passed after adding `agent rename`:

```bash
bun run --filter t3 test -- src/bin.test.ts
bun run --filter t3 typecheck
bun run fmt:check
git diff --check
```

End-to-end comms tests already performed:

- Bob and Joe were registered and listed as active comms actors.
- Joe successfully sent Bob `hi Bob`.
- Bob received it and replied `hi Joe`.
- A six-message alternating direct comms test completed with all deliveries marked `delivered`.
- A first-person style correction was loaded and acknowledged by both agents.
- A quiet-ack correction was loaded and acknowledged by both agents.
- A quiet-ack test produced local `sent` replies while actual content moved through comms.
- An eight-message news conversation completed with direct comms messages alternating between Bob and Joe.

Known quality issue from the news test:

- Agents can be asked to "look up news", but source quality is inconsistent.
- They may cite URLs from their own available tool path that are not ideal.
- Future work should add a first-class, auditable source lookup tool or make the UI clearly distinguish sourced claims from casual discussion.

## Known Rough Edges

Short-term rough edges:

- The raw dev CLI command is too long for agents to use comfortably.
- Agents need prompt instructions to use comms. There is no native provider tool yet.
- Local thread transcripts still receive injected comms messages as ordinary user turns.
- Local assistant `sent` acknowledgements are better than long chatter, but still add transcript noise.
- `agent rename` changes thread title only, not comms handle.
- Cross-project comms are global-handle based and not scoped or permissioned yet.
- Source lookup quality is not enforced.

Medium-term design gaps:

- Need explicit actor profile UI: display name, handle, project, current thread, status.
- Need inbox/outbox UI and unread state.
- Need group conversations in UI.
- Need handle aliases or handle rename semantics.
- Need a short stable CLI or native tool interface for providers.
- Need delivery observability in UI: delivered, failed, skipped, pending.
- Need a way to reduce transcript pollution from comms injections.
- Need Clawsenger later for remote instance trust and prompt-injection controls.

## Important Code Areas

Start here:

- `docs/interagent-comms.md`
- `packages/contracts/src/comms.ts`
- `packages/contracts/src/rpc.ts`
- `apps/server/src/persistence/Migrations/031_Comms.ts`
- `apps/server/src/persistence/Services/Comms.ts`
- `apps/server/src/persistence/Layers/Comms.ts`
- `apps/server/src/cli/orchestrationCli.ts`
- `apps/server/src/cli/agent.ts`
- `apps/server/src/cli/comms.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/bin.test.ts`
- `apps/server/src/persistence/Layers/Comms.test.ts`

## Useful Commands

List live agents:

```bash
node apps/server/src/bin.ts --log-level error agent list --project t3code --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

List comms actors:

```bash
node apps/server/src/bin.ts --log-level error comms actors --project t3code --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Send a direct message from River to Bob after River is registered:

```bash
node apps/server/src/bin.ts --log-level error comms send river bob 'hi Bob' --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733 --type direct
```

Read River inbox after River is registered:

```bash
node apps/server/src/bin.ts --log-level error comms inbox river --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Rename a thread by handle:

```bash
node apps/server/src/bin.ts --log-level error agent rename river river --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

## Recommended Next Work

First, take control safely:

1. Run `git status --short`.
2. Read this file and `docs/interagent-comms.md`.
3. Inspect the dirty diff, especially CLI, contracts, repository, and WS handlers.
4. Run the verification commands listed above.
5. Send Bob and Joe a short comms hello to verify your own `@river` handle works.

Then continue development:

1. Add or refine tests for cross-project comms and handle-vs-title behavior.
2. Decide whether `agent rename` should optionally update display name or handle aliases.
3. Collapse agent-facing comms into a shorter command.
4. Start UI planning for actor list, inbox, and delivery state.
5. Keep the backend stable before adding frontend polish.

## First Prompt for New River

Read `docs/handoffs/river-t3-transfer-2026-05-19.md` and `docs/interagent-comms.md`. You are the new T3-managed River agent. Continue development from the current dirty working tree in `/home/zeul/GIT/t3code`.

Your first actions should be:

1. Run `git status --short`.
2. Inspect the listed changed files.
3. Verify the current backend with targeted tests.
4. Register or confirm your comms handle `@river`.
5. Send a short direct comms hello to `@bob` and `@joe`.
6. Report what you found and what you recommend next.

Do not reset or discard changes. Do not make broad rewrites until you understand the current implementation.
