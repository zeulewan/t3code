import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

async function seedThreadReadModel() {
  const now = "2026-01-01T00:00:00.000Z";
  const projectId = asProjectId("project-messages");
  const threadId = asThreadId("thread-messages");
  const initial = createEmptyReadModel(now);
  const withProject = await Effect.runPromise(
    projectEvent(initial, {
      sequence: 1,
      eventId: asEventId("evt-project-messages"),
      aggregateKind: "project",
      aggregateId: projectId,
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-messages"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-messages"),
      metadata: {},
      payload: {
        projectId,
        title: "Messages",
        workspaceRoot: "/tmp/messages",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-messages"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-messages"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-messages"),
      metadata: {},
      payload: {
        threadId,
        projectId,
        title: "Imported Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

describe("decider message flows", () => {
  it("emits a non-streaming message event for imported transcript messages", async () => {
    const readModel = await seedThreadReadModel();
    const createdAt = "2026-01-01T00:00:03.000Z";

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.message.import",
          commandId: asCommandId("cmd-message-import"),
          threadId: asThreadId("thread-messages"),
          message: {
            messageId: asMessageId("message-imported"),
            role: "assistant",
            text: "Imported assistant answer.",
            turnId: asTurnId("turn-imported"),
            createdAt,
          },
          createdAt,
        },
        readModel,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("thread.message-sent");
    expect(event.payload).toMatchObject({
      threadId: asThreadId("thread-messages"),
      messageId: asMessageId("message-imported"),
      role: "assistant",
      text: "Imported assistant answer.",
      turnId: asTurnId("turn-imported"),
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    });
  });
});
