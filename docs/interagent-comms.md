# Inter-Agent Comms

## Purpose

ClawMux/T3-style multi-agent work needs a durable messaging layer that supports:

- agent-to-agent messages
- human-to-agent messages
- agent-to-human messages
- DMs
- group chats
- announcements
- inbox/outbox views
- later provider switching while preserving recent working context

The core rule is that humans and agents should use the same comms model. A human DM to an agent and an agent DM to another agent should differ only by participant type, not by storage shape.

## Current T3 Baseline

Current T3 has thread projection tables such as:

- `projection_threads`
- `projection_thread_messages`
- `projection_thread_sessions`

`projection_thread_messages` is the visible thread transcript. It stores chat messages for one thread using columns like `message_id`, `thread_id`, `turn_id`, `role`, `text`, `is_streaming`, `created_at`, and `updated_at`.

That table should not become the general mailbox. It is the thread transcript.

Inter-agent comms should be a separate durable comms layer. Only interruptive/direct messages should optionally be injected into the target thread transcript.

## Implemented V1

This branch adds the first backend-only iteration:

- SQL migration `031_Comms`.
- Contracts in `packages/contracts/src/comms.ts`.
- Persistence service `CommsRepository`.
- WebSocket RPC methods for future UI integration.
- CLI tools:
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

V1 is local-only. Remote instance trust, filtering, and prompt-injection controls belong to the future Clawsenger layer and are intentionally not implemented here.

`t3 comms send --type direct` and `--type notify` can inject into recipient threads when a live T3 server is running and the recipient actor has a `thread_id`. `--type defer` stores only an inbox message. `--no-deliver` stores a message without runtime injection.

`t3 agent spawn` also seeds the spawned agent with the exact comms CLI template it can run when asked to message another agent. This is intentionally explicit for V1: the provider does not get a native `send_agent_message` tool yet, so the agent uses its normal shell command tool. `t3 agent send` accepts either a thread id/title or a comms handle such as `joe`.

## Concepts

### Actor

An actor is an addressable identity.

This is a new explicit concept relative to current T3, where a thread currently acts as the main work/session container.

An actor can be a human, agent, system actor, or later a remote actor. An agent actor can have:

- a stable id
- a handle like `joe`
- a display name like `Joe`
- a current thread
- a provider/model
- historical threads over time

The user-facing address should be the actor handle, not a raw thread id.

### Thread

A thread is a runtime/work context.

Threads are where providers run, where transcript messages are shown, and where direct messages may be injected. Threads should not be the primary identity for addressing because a human may rename a thread, switch providers, or later move an agent to a new thread.

### Conversation

A conversation is the container where comms messages live.

Conversation kinds:

- `dm`: one-to-one conversation
- `group`: multi-participant conversation
- `announcement`: broadcast-style conversation

A DM is not a separate message table. It is a row in `comms_conversations` with two participants.

### Message

A message is the immutable content sent inside a conversation.

Message types:

- `direct`: interruptive; attempt to inject into recipient agent runtime/thread
- `notify`: notify recipient that a message exists, without injecting full content
- `defer`: inbox only; no runtime notification

Do not add `groupchat` as a message type. Group chat is a conversation kind.

### Delivery

A delivery is the per-recipient state for one message.

This is required for one-to-many messaging. One group message can be read by one recipient, injected into another, and fail for a third.

## SQL Shape

### `comms_actors`

Addressable local participants.

```text
actor_id
kind              human | agent | system | remote
handle
display_name
status            active | inactive
project_id
thread_id
provider_instance_id
model
metadata_json
created_at
updated_at
```

Notes:

- `handle` is currently globally unique.
- `thread_id` is nullable because humans and deferred/remote actors may not have a live provider thread.
- This combines the earlier separate `agents` and `comms_participants` ideas into one table for V1. If remote identity/trust gets complex enough later, remote-specific profile tables can reference `actor_id` without changing message storage.

### `comms_conversations`

DMs, groups, and announcement channels.

```text
conversation_id
project_id
kind              dm | group | announcement
title
metadata_json
created_at
updated_at
```

### `comms_conversation_participants`

Membership in a conversation.

```text
conversation_id
actor_id
role              owner | member
joined_at
left_at
last_read_message_id
```

Suggested constraints:

- unique `(conversation_id, actor_id)`
- for DMs, enforce or maintain one canonical conversation per unordered participant pair

### `comms_messages`

One table for all comms messages, inbound and outbound.

```text
message_id
conversation_id
sender_actor_id
message_type      direct | notify | defer
body
metadata_json
created_at
```

Inbox and outbox are queries, not separate tables.

Inbox:

```sql
SELECT messages.*
FROM comms_messages messages
JOIN comms_deliveries deliveries ON deliveries.message_id = messages.message_id
WHERE deliveries.recipient_actor_id = :actor_id;
```

Outbox:

```sql
SELECT *
FROM comms_messages
WHERE sender_actor_id = :actor_id;
```

### `comms_deliveries`

Per-recipient delivery state.

```text
delivery_id
message_id
recipient_actor_id
target_thread_id
status            pending | delivered | read | failed | ignored
error
created_at
updated_at
delivered_at
read_at
```

Notes:

- `target_thread_id` is copied from the actor at send time. This preserves where delivery was attempted even if the actor later moves to a different thread.
- deliveries are what make group chat and announcements possible

## Behavior By Message Type

### `direct`

`direct` means “try to put this into the recipient's active context.”

For an agent recipient:

1. Insert `comms_messages`.
2. Insert one `comms_deliveries` row per recipient.
3. If the recipient agent is active, inject into its current runtime/thread.
4. If inactive, keep delivery `pending`.
5. When injected, set status `delivered` and record `delivered_at`.

`direct` may create or correspond to a visible `projection_thread_messages` row for the recipient thread.

### `notify`

`notify` means “tell the recipient there is a message, but do not inject the full body.”

For an agent recipient:

1. Insert comms message and delivery rows.
2. Send a lightweight runtime/UI event.
3. In V1, if injected successfully, set status `delivered`; a later UI-native notification path can add a more precise notification state if needed.
4. Recipient can explicitly open/read the inbox item.

`notify` should not create a normal thread transcript message by default.

### `defer`

`defer` means “store this for later.”

For any recipient:

1. Insert comms message and delivery rows.
2. Do not notify runtime.
3. Show in inbox/DM list when the recipient checks messages.

## Addressing Model

Humans should address agents and conversations by handles.

Examples:

```text
@joe
@bob
@frontend-team
@all
```

Resolution order should usually be:

1. current project agent handles
2. current project conversation handles/titles
3. explicit project-scoped handles
4. global/system handles

Thread IDs should remain an advanced/debug address only.

Examples:

```text
Bob, direct Joe: "Look at the reconnect bug."
Bob, notify frontend-team: "I pushed the mobile scale fix."
Bob, defer this to Sarah: "Review this later."
Announce to all agents: "Stop using the old Claude backend for now."
```

## DM List UI

The user should eventually be able to see a list of DMs.

This should be powered by `comms_conversations`, not by scanning thread titles.

DM list query shape:

```text
conversation id
participants
last message preview
last message time
unread count for current participant
delivery states for latest message
```

The DM list should include:

- human-agent DMs
- agent-agent DMs visible to the human when permission allows
- unread counts
- last activity ordering
- archived/muted state later

This is a later UI phase, but the schema should be designed for it now.

## Provider Switching / Context Transfer

Provider switching should be treated as a separate feature from comms, but the two should interoperate.

Goal:

- switch an agent from one provider to another
- preserve enough recent context for the new provider to continue effectively

Proposed behavior:

1. User selects an agent.
2. User chooses a new provider/model.
3. System creates a new provider session/runtime for the same agent `actor_id`.
4. System takes the last N visible thread messages, likely around 100.
5. System converts them into a provider-neutral transcript summary/context packet.
6. System starts the new provider with that packet.
7. Agent identity remains the same; `comms_actors.thread_id` or session linkage updates as needed.

This should not be implemented as raw provider JSONL conversion first. The safer first version is provider-neutral replay/context injection from projected messages.

Provider switch state should be tracked separately from comms:

```text
agent_provider_switches
id
actor_id
from_provider_instance_id
to_provider_instance_id
from_thread_id
to_thread_id
source_message_count
summary
status
created_at
completed_at
error
```

Open question:

- whether provider switching reuses the same thread or creates a new thread linked to the same agent

Recommendation:

- keep the same agent `actor_id`
- create a new provider session
- decide same-thread vs new-thread based on UI/implementation constraints
- never make provider identity the same thing as agent identity

## Feature Boundaries

### Agent Identity

Owns:

- handle
- display name
- current thread
- provider/model defaults

Does not own:

- message bodies
- delivery state
- transcript projection

### Comms

Owns:

- conversations
- participants
- messages
- deliveries
- inbox/outbox/read state
- DM list data

Does not own:

- provider sessions
- model selection
- raw thread transcript

### Runtime Injection

Owns:

- taking `direct` delivery rows
- injecting them into active agent runtimes
- marking delivery status

Does not own:

- comms storage
- conversation membership

### Thread Transcript

Owns:

- visible provider conversation history
- projected user/assistant messages
- streaming state

Does not own:

- mailbox/inbox
- group chat membership

### Provider Switching

Owns:

- selecting a new provider/model for an agent
- collecting recent context
- starting/resuming provider runtime
- recording switch history

Does not own:

- comms delivery semantics

## Suggested Implementation Phases

### Phase 1: Schema And Identity

- Add `comms_actors`.
- Add `comms_conversations`.
- Add `comms_conversation_participants`.
- Add `comms_messages`.
- Add `comms_deliveries`.
- Add CLI registration for human/agent/system/remote actors.
- Register newly spawned CLI agents as actors.

Status: implemented for local actors and CLI-spawned agents.

CLI-spawned agents are prompted with their own comms handle and the command template for sending direct messages. This makes agent-to-agent messaging discoverable to the model without adding a provider-specific tool yet.

### Phase 2: Basic DM Send/Receive

- Support human-to-agent DM.
- Support agent-to-agent DM through a server-side command/tool.
- Store all messages in `comms_messages`.
- Use deliveries for inbox/outbox/read status.
- No group chat UI yet.

Status: implemented at the backend/CLI layer. Frontend UI is not implemented.

### Phase 3: Delivery Modes

- Implement `direct`.
- Implement `notify`.
- Implement `defer`.
- Add runtime injection for `direct`.
- Add lightweight inbox notification for `notify`.

Status: partially implemented. CLI `direct` injects full content into a live target thread. CLI `notify` injects a lightweight prompt into a live target thread. `defer` is inbox-only. A native UI notification stream can come later.

### Phase 4: DM List UI

- Add DM list.
- Show unread counts.
- Show last message previews.
- Allow opening DM conversation detail.

### Phase 5: Groups And Announcements

- Add group creation.
- Add group membership management.
- Add announcements using `conversation.kind = announcement`.
- Keep message types limited to `direct`, `notify`, `defer`.

### Phase 6: Provider Switcher

- Add provider switch UI.
- Take last ~100 projected thread messages.
- Build provider-neutral context packet.
- Start new provider runtime under the same agent identity.
- Record switch history.

## Current Recommendation

Use this model:

```text
comms_actors = durable addressable humans/agents/system/remote identities
threads = runtime work contexts
comms_conversations = DMs/groups/announcements
comms_messages = one table for all human and agent comms messages
comms_deliveries = per-recipient state for one-to-many
projection_thread_messages = visible provider transcript only
```

This gives the app a clean foundation for Bob messaging Joe, human DMs, group chats, announcement channels, inbox/outbox, and later provider switching without making thread titles or provider sessions carry too much responsibility.

## CLI Examples

Register two local actors without live runtime delivery:

```sh
t3 comms register bob --kind agent
t3 comms register joe --kind agent
t3 comms send bob joe "Can you review this?" --type defer
t3 comms inbox joe
```

Inside an agent runtime, `comms send` can autodetect the sender from `T3_THREAD_ID`, with `T3_COMMS_HANDLE` as a fallback:

```sh
t3 comms send joe "Can you review this?" --type defer
```

Spawn a live Codex-backed agent with low reasoning:

```sh
t3 agent spawn /path/to/project bob "Start by checking the failing tests" --provider codex --model gpt-5.4 --effort low
```

Attach comms to an existing thread:

```sh
t3 comms register joe --kind agent --thread <thread-id>
```

Send an interruptive direct message:

```sh
t3 comms send joe "Please look at issue #20" --type direct
```

Outside an agent runtime, keep using the explicit sender form:

```sh
t3 comms send bob joe "Please look at issue #20" --type direct
```
