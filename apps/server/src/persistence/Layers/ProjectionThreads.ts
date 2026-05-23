import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadInput,
  GetProjectionThreadInput,
  ListProjectionThreadsByProjectInput,
  ProjectionThread,
  ProjectionThreadRepository,
  type ProjectionThreadRepositoryShape,
} from "../Services/ProjectionThreads.ts";
import {
  ModelSelection,
  ThreadIdentityColor,
  ThreadIdentityIcon,
  ThreadIdentityPreset,
} from "@t3tools/contracts";
import { getThreadIdentityPreset } from "@t3tools/shared/threadIdentity";

const ProjectionThreadDbRow = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  projectId: ProjectionThread.fields.projectId,
  title: ProjectionThread.fields.title,
  identityPreset: ThreadIdentityPreset,
  identityIcon: ThreadIdentityIcon,
  identityColor: ThreadIdentityColor,
  modelSelection: Schema.fromJsonString(ModelSelection),
  runtimeMode: ProjectionThread.fields.runtimeMode,
  interactionMode: ProjectionThread.fields.interactionMode,
  branch: ProjectionThread.fields.branch,
  worktreePath: ProjectionThread.fields.worktreePath,
  latestTurnId: ProjectionThread.fields.latestTurnId,
  createdAt: ProjectionThread.fields.createdAt,
  updatedAt: ProjectionThread.fields.updatedAt,
  archivedAt: ProjectionThread.fields.archivedAt,
  latestUserMessageAt: ProjectionThread.fields.latestUserMessageAt,
  pendingApprovalCount: ProjectionThread.fields.pendingApprovalCount,
  pendingUserInputCount: ProjectionThread.fields.pendingUserInputCount,
  hasActionableProposedPlan: ProjectionThread.fields.hasActionableProposedPlan,
  deletedAt: ProjectionThread.fields.deletedAt,
});
type ProjectionThreadDbRow = typeof ProjectionThreadDbRow.Type;

function toProjectionThread(row: ProjectionThreadDbRow): ProjectionThread {
  const preset = getThreadIdentityPreset(row.identityPreset);
  return {
    threadId: row.threadId,
    projectId: row.projectId,
    title: row.title,
    identity: {
      preset: row.identityPreset,
      name: preset.name,
      icon: row.identityIcon,
      color: row.identityColor,
    },
    modelSelection: row.modelSelection,
    runtimeMode: row.runtimeMode,
    interactionMode: row.interactionMode,
    branch: row.branch,
    worktreePath: row.worktreePath,
    latestTurnId: row.latestTurnId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    latestUserMessageAt: row.latestUserMessageAt,
    pendingApprovalCount: row.pendingApprovalCount,
    pendingUserInputCount: row.pendingUserInputCount,
    hasActionableProposedPlan: row.hasActionableProposedPlan,
    deletedAt: row.deletedAt,
  };
}

const makeProjectionThreadRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadRow = SqlSchema.void({
    Request: ProjectionThread,
    execute: (row) =>
      sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          identity_preset,
          identity_icon,
          identity_color,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.title},
          ${row.identity.preset},
          ${row.identity.icon},
          ${row.identity.color},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.branch},
          ${row.worktreePath},
          ${row.latestTurnId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.latestUserMessageAt},
          ${row.pendingApprovalCount},
          ${row.pendingUserInputCount},
          ${row.hasActionableProposedPlan},
          ${row.deletedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          identity_preset = excluded.identity_preset,
          identity_icon = excluded.identity_icon,
          identity_color = excluded.identity_color,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          latest_turn_id = excluded.latest_turn_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          latest_user_message_at = excluded.latest_user_message_at,
          pending_approval_count = excluded.pending_approval_count,
          pending_user_input_count = excluded.pending_user_input_count,
          has_actionable_proposed_plan = excluded.has_actionable_proposed_plan,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadInput,
    Result: ProjectionThreadDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          identity_preset AS "identityPreset",
          identity_icon AS "identityIcon",
          identity_color AS "identityColor",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const listProjectionThreadRows = SqlSchema.findAll({
    Request: ListProjectionThreadsByProjectInput,
    Result: ProjectionThreadDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          identity_preset AS "identityPreset",
          identity_icon AS "identityIcon",
          identity_color AS "identityColor",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const deleteProjectionThreadRow = SqlSchema.void({
    Request: DeleteProjectionThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.upsert:query")),
    );

  const getById: ProjectionThreadRepositoryShape["getById"] = (input) =>
    getProjectionThreadRow(input).pipe(
      Effect.map((row) => Option.map(row, toProjectionThread)),
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.getById:query")),
    );

  const listByProjectId: ProjectionThreadRepositoryShape["listByProjectId"] = (input) =>
    listProjectionThreadRows(input).pipe(
      Effect.map((rows) => rows.map(toProjectionThread)),
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.listByProjectId:query")),
    );

  const deleteById: ProjectionThreadRepositoryShape["deleteById"] = (input) =>
    deleteProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    deleteById,
  } satisfies ProjectionThreadRepositoryShape;
});

export const ProjectionThreadRepositoryLive = Layer.effect(
  ProjectionThreadRepository,
  makeProjectionThreadRepository,
);
