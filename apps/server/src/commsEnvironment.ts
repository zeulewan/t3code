import { makeThreadCommsHandle } from "./commsHandles.ts";

export const T3_THREAD_ID_ENV = "T3_THREAD_ID";
export const T3_COMMS_HANDLE_ENV = "T3_COMMS_HANDLE";
export const T3_COMMS_HANDLE_FALLBACK_ENVS = [
  T3_COMMS_HANDLE_ENV,
  "T3_AGENT_HANDLE",
  "T3_ACTOR_HANDLE",
] as const;

function nonEmptyEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readAutoCommsSenderEnv(env: NodeJS.ProcessEnv = process.env): {
  readonly threadId?: string;
  readonly handle?: string;
  readonly handleSource?: string;
} {
  const threadId = nonEmptyEnvValue(env[T3_THREAD_ID_ENV]);
  for (const name of T3_COMMS_HANDLE_FALLBACK_ENVS) {
    const handle = nonEmptyEnvValue(env[name]);
    if (handle) {
      return {
        ...(threadId ? { threadId } : {}),
        handle,
        handleSource: name,
      };
    }
  }
  return threadId ? { threadId } : {};
}

export function withCommsSessionEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  input: {
    readonly threadId: string;
    readonly title?: string | undefined;
  },
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...(environment ?? process.env),
    [T3_THREAD_ID_ENV]: input.threadId,
  };
  if (input.title && input.title.trim().length > 0) {
    next[T3_COMMS_HANDLE_ENV] = makeThreadCommsHandle({
      title: input.title,
      threadId: input.threadId,
    });
  }
  return next;
}
