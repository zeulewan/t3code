import * as Schema from "effect/Schema";
import {
  TrimmedNonEmptyString,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode, ProviderInteractionMode } from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const CodexSessionSummary = Schema.Struct({
  providerThreadId: TrimmedNonEmptyString,
  sessionId: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  preview: Schema.String,
  cwd: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  path: Schema.NullOr(Schema.String),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
});
export type CodexSessionSummary = typeof CodexSessionSummary.Type;

export const CodexSessionListInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  cwd: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  searchTerm: Schema.optional(Schema.NullOr(Schema.String)),
  limit: Schema.optional(PositiveInt),
  allFolders: Schema.optional(Schema.Boolean),
});
export type CodexSessionListInput = typeof CodexSessionListInput.Type;

export const CodexSessionListResult = Schema.Struct({
  sessions: Schema.Array(CodexSessionSummary),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
});
export type CodexSessionListResult = typeof CodexSessionListResult.Type;

export const CodexSessionImportInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  providerThreadId: TrimmedNonEmptyString,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  title: Schema.optional(TrimmedNonEmptyString),
});
export type CodexSessionImportInput = typeof CodexSessionImportInput.Type;

export const CodexSessionImportResult = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: TrimmedNonEmptyString,
  importedMessages: NonNegativeInt,
});
export type CodexSessionImportResult = typeof CodexSessionImportResult.Type;

export class CodexSessionError extends Schema.TaggedErrorClass<CodexSessionError>()(
  "CodexSessionError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
