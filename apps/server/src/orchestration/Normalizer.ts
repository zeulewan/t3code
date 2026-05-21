import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  CHAT_ATTACHMENT_MAX_FILE_BYTES,
  type ChatAttachment,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import { WorkspacePaths } from "../workspace/Services/WorkspacePaths.ts";

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const workspacePaths = yield* WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (workspaceRoot: string) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    const normalizeProjectWorkspaceRootForCreate = (
      workspaceRoot: string,
      createIfMissing: boolean | undefined,
    ) =>
      workspacePaths
        .normalizeWorkspaceRoot(workspaceRoot, {
          createIfMissing: createIfMissing === true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: cause.message,
              }),
          ),
        );

    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRootForCreate(
          command.workspaceRoot,
          command.createWorkspaceRootIfMissing,
        ),
        createWorkspaceRootIfMissing: command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
    }

    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    const persistUploadAttachments = (input: {
      readonly threadId: ThreadId;
      readonly attachments: ReadonlyArray<UploadChatAttachment>;
      readonly allowGenericAttachments: boolean;
    }): Effect.Effect<ReadonlyArray<ChatAttachment>, OrchestrationDispatchCommandError> =>
      Effect.forEach(
        input.attachments,
        (attachment) =>
          Effect.gen(function* () {
            const parsed = parseBase64DataUrl(attachment.dataUrl);
            if (!parsed) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Invalid attachment payload for '${attachment.name}'.`,
              });
            }

            const mimeType = parsed.mimeType.toLowerCase();
            if (attachment.type === "image" && !mimeType.startsWith("image/")) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Invalid image attachment MIME type '${mimeType}' for '${attachment.name}'.`,
              });
            }
            if (attachment.type === "video" && !mimeType.startsWith("video/")) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Invalid video attachment MIME type '${mimeType}' for '${attachment.name}'.`,
              });
            }
            if (!input.allowGenericAttachments && attachment.type !== "image") {
              return yield* new OrchestrationDispatchCommandError({
                message: `Only image attachments can be sent to provider turns.`,
              });
            }

            const bytes = Buffer.from(parsed.base64, "base64");
            const maxBytes =
              attachment.type === "image"
                ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
                : CHAT_ATTACHMENT_MAX_FILE_BYTES;
            if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Attachment '${attachment.name}' is empty or too large.`,
              });
            }

            const attachmentId = createAttachmentId(input.threadId);
            if (!attachmentId) {
              return yield* new OrchestrationDispatchCommandError({
                message: "Failed to create a safe attachment id.",
              });
            }

            const persistedAttachment = {
              type: attachment.type,
              id: attachmentId,
              name: attachment.name,
              mimeType,
              sizeBytes: bytes.byteLength,
            } satisfies ChatAttachment;

            const attachmentPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment: persistedAttachment,
            });
            if (!attachmentPath) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Failed to resolve persisted path for '${attachment.name}'.`,
              });
            }

            yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
              Effect.mapError(
                () =>
                  new OrchestrationDispatchCommandError({
                    message: `Failed to create attachment directory for '${attachment.name}'.`,
                  }),
              ),
            );
            yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
              Effect.mapError(
                () =>
                  new OrchestrationDispatchCommandError({
                    message: `Failed to persist attachment '${attachment.name}'.`,
                  }),
              ),
            );

            return persistedAttachment;
          }),
        { concurrency: 1 },
      );

    if (command.type === "thread.turn.start") {
      const normalizedAttachments = yield* persistUploadAttachments({
        threadId: command.threadId,
        attachments: command.message.attachments,
        allowGenericAttachments: false,
      });

      return {
        ...command,
        message: {
          ...command.message,
          attachments: normalizedAttachments,
        },
      } satisfies OrchestrationCommand;
    }

    if (command.type === "thread.message.import") {
      const normalizedAttachments = yield* persistUploadAttachments({
        threadId: command.threadId,
        attachments: command.message.attachments ?? [],
        allowGenericAttachments: true,
      });

      return {
        type: "thread.message.import",
        commandId: command.commandId,
        threadId: command.threadId,
        message: {
          messageId: command.message.messageId,
          role: command.message.role,
          text: command.message.text,
          ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
          turnId: command.message.turnId,
          createdAt: command.message.createdAt,
        },
        createdAt: command.createdAt,
      } satisfies OrchestrationCommand;
    }

    return command as OrchestrationCommand;
  });
