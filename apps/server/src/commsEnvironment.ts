import { makeThreadCommsHandle } from "./commsHandles.ts";

export const T3_THREAD_ID_ENV = "T3_THREAD_ID";
export const T3_COMMS_HANDLE_ENV = "T3_COMMS_HANDLE";
export const T3_RUNTIME_ENV = "T3_RUNTIME";
export const T3_BASE_DIR_ENV = "T3_BASE_DIR";
export const T3_STATE_DIR_ENV = "T3_STATE_DIR";
export const T3_DEV_URL_ENV = "T3_DEV_URL";
export const T3_COMMS_FLAGS_ENV = "T3_COMMS_FLAGS";
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeUrl(value: URL | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : value.href;
}

export function buildT3CommsFlags(input: {
  readonly baseDir: string;
  readonly devUrl?: URL | string | undefined;
}): string {
  const flags = ["--base-dir", shellQuote(input.baseDir)];
  const devUrl = normalizeUrl(input.devUrl);
  if (devUrl !== undefined) {
    flags.push("--dev-url", shellQuote(devUrl));
  }
  return flags.join(" ");
}

export function withCommsSessionEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  input: {
    readonly threadId: string;
    readonly title?: string | undefined;
    readonly baseDir?: string | undefined;
    readonly stateDir?: string | undefined;
    readonly devUrl?: URL | string | undefined;
  },
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...(environment ?? process.env),
    [T3_THREAD_ID_ENV]: input.threadId,
  };
  if (input.baseDir !== undefined) {
    const devUrl = normalizeUrl(input.devUrl);
    next[T3_RUNTIME_ENV] = devUrl === undefined ? "prod" : "dev";
    next[T3_BASE_DIR_ENV] = input.baseDir;
    next[T3_COMMS_FLAGS_ENV] = buildT3CommsFlags({
      baseDir: input.baseDir,
      ...(devUrl !== undefined ? { devUrl } : {}),
    });
    if (input.stateDir !== undefined) {
      next[T3_STATE_DIR_ENV] = input.stateDir;
    }
    if (devUrl === undefined) {
      delete next[T3_DEV_URL_ENV];
    } else {
      next[T3_DEV_URL_ENV] = devUrl;
    }
  }
  if (input.title && input.title.trim().length > 0) {
    next[T3_COMMS_HANDLE_ENV] = makeThreadCommsHandle({
      title: input.title,
      threadId: input.threadId,
    });
  }
  return next;
}
