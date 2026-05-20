#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import * as Net from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const DEFAULT_BASE_DIR = NodePath.join(NodeOS.homedir(), ".t3");
const DEFAULT_GRACE_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 30_000;

interface ServerRuntimeState {
  readonly version: 1;
  readonly pid: number;
  readonly host?: string;
  readonly port: number;
  readonly origin: string;
  readonly startedAt: string;
}

interface RestartOptions {
  readonly baseDir: string;
  readonly cwd: string;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly forceKill: boolean;
  readonly graceMs: number;
  readonly help: boolean;
  readonly logFile: string | undefined;
  readonly runtimeStatePath: string | undefined;
  readonly timeoutMs: number;
}

function usage(): string {
  return `Usage: bun restart:server [options]

Gracefully restart the currently running T3 web server from its runtime state.

Options:
  --base-dir <path>          T3 data dir. Default: ~/.t3
  --runtime-state <path>     Runtime state JSON. Default: first live state under <base-dir>/{dev,userdata}
  --cwd <path>               Repository cwd used to relaunch relative commands. Default: current directory
  --log-file <path>          Restart output log. Default: <runtime-state-dir>/logs/server-restart.log
  --grace-ms <ms>            Time to wait after SIGTERM. Default: ${DEFAULT_GRACE_MS}
  --timeout-ms <ms>          Time to wait for restart health checks. Default: ${DEFAULT_TIMEOUT_MS}
  --force                    Allow restarting commands that do not look like the T3 server
  --force-kill              Send SIGKILL if SIGTERM does not stop the server in time
  --dry-run                  Print what would happen without stopping or starting anything
  -h, --help                 Show this help
`;
}

function parseArgs(argv: ReadonlyArray<string>): RestartOptions {
  const options: {
    baseDir: string;
    cwd: string;
    dryRun: boolean;
    force: boolean;
    forceKill: boolean;
    graceMs: number;
    help: boolean;
    logFile: string | undefined;
    runtimeStatePath: string | undefined;
    timeoutMs: number;
  } = {
    baseDir: DEFAULT_BASE_DIR,
    cwd: process.cwd(),
    dryRun: false,
    force: false,
    forceKill: false,
    graceMs: DEFAULT_GRACE_MS,
    help: false,
    logFile: undefined,
    runtimeStatePath: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--base-dir":
        options.baseDir = requireValue(argv, ++index, arg);
        break;
      case "--cwd":
        options.cwd = requireValue(argv, ++index, arg);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--force-kill":
        options.forceKill = true;
        break;
      case "--grace-ms":
        options.graceMs = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--log-file":
        options.logFile = requireValue(argv, ++index, arg);
        break;
      case "--runtime-state":
        options.runtimeStatePath = requireValue(argv, ++index, arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    ...options,
    baseDir: resolvePath(options.baseDir),
    cwd: resolvePath(options.cwd),
    logFile: options.logFile === undefined ? undefined : resolvePath(options.logFile),
    runtimeStatePath:
      options.runtimeStatePath === undefined ? undefined : resolvePath(options.runtimeStatePath),
  };
}

function requireValue(argv: ReadonlyArray<string>, index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function resolvePath(path: string): string {
  if (path === "~") {
    return NodeOS.homedir();
  }
  if (path.startsWith("~/")) {
    return NodePath.join(NodeOS.homedir(), path.slice(2));
  }
  return NodePath.resolve(path);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const runtimeStatePath = await resolveRuntimeStatePath(options);
  const previousState = await readRuntimeState(runtimeStatePath);
  const launchCommand = await readProcessCommand(previousState.pid);

  if (launchCommand.length === 0) {
    throw new Error(
      `Could not read /proc/${previousState.pid}/cmdline. Start the server manually once, then rerun this script.`,
    );
  }

  if (!options.force && !looksLikeT3ServerCommand(launchCommand)) {
    throw new Error(
      `Refusing to restart pid ${previousState.pid}; command does not look like the T3 server. Use --force if this is expected.\nCommand: ${formatCommand(
        launchCommand,
      )}`,
    );
  }

  const logFile =
    options.logFile ??
    NodePath.join(NodePath.dirname(runtimeStatePath), "logs", "server-restart.log");
  const healthTarget = resolveHealthTarget(previousState);

  printPlan({
    healthTarget,
    launchCommand,
    logFile,
    options,
    previousState,
    runtimeStatePath,
  });

  if (options.dryRun) {
    return;
  }

  await stopServer(previousState.pid, options);
  await startServer(launchCommand, options.cwd, logFile);

  const nextState = await waitForRuntimeStateRestart(
    runtimeStatePath,
    previousState.pid,
    options.timeoutMs,
  );
  await waitForPortOpen(healthTarget.host, healthTarget.port, options.timeoutMs);

  console.log(
    `T3 server restarted: pid ${previousState.pid} -> ${nextState.pid}, ${nextState.origin}`,
  );
}

async function resolveRuntimeStatePath(options: RestartOptions): Promise<string> {
  if (options.runtimeStatePath !== undefined) {
    return options.runtimeStatePath;
  }

  const candidates = [
    NodePath.join(options.baseDir, "dev", "server-runtime.json"),
    NodePath.join(options.baseDir, "userdata", "server-runtime.json"),
  ];

  const existing: Array<{ path: string; state: ServerRuntimeState }> = [];
  for (const candidate of candidates) {
    const state = await readRuntimeStateOrUndefined(candidate);
    if (state !== undefined) {
      existing.push({ path: candidate, state });
    }
  }

  for (const candidate of existing) {
    if (isProcessAlive(candidate.state.pid)) {
      return candidate.path;
    }
  }

  if (existing[0] !== undefined) {
    return existing[0].path;
  }

  throw new Error(
    `No server runtime state found under ${options.baseDir}. Expected one of: ${candidates.join(
      ", ",
    )}`,
  );
}

async function readRuntimeStateOrUndefined(path: string): Promise<ServerRuntimeState | undefined> {
  try {
    return await readRuntimeState(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readRuntimeState(path: string): Promise<ServerRuntimeState> {
  const raw = await readFile(path, "utf8");
  const decoded = JSON.parse(raw) as Partial<ServerRuntimeState>;
  if (
    decoded.version !== 1 ||
    !Number.isInteger(decoded.pid) ||
    !Number.isInteger(decoded.port) ||
    typeof decoded.origin !== "string" ||
    typeof decoded.startedAt !== "string"
  ) {
    throw new Error(`Invalid server runtime state: ${path}`);
  }
  return decoded as ServerRuntimeState;
}

async function readProcessCommand(pid: number): Promise<Array<string>> {
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`);
    return raw.toString("utf8").split("\0").filter(Boolean);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function looksLikeT3ServerCommand(command: ReadonlyArray<string>): boolean {
  const hasServerEntrypoint = command.some(
    (arg) =>
      arg.endsWith("apps/server/src/bin.ts") ||
      arg.endsWith("apps/server/dist/bin.js") ||
      arg.endsWith("apps/server/dist/bin.mjs"),
  );
  const hasServerMode = command.includes("serve") || command.includes("start");
  return hasServerEntrypoint && hasServerMode;
}

function resolveHealthTarget(state: ServerRuntimeState): {
  readonly host: string;
  readonly port: number;
} {
  try {
    const origin = new URL(state.origin);
    return {
      host: origin.hostname,
      port: Number(origin.port) || (origin.protocol === "https:" ? 443 : 80),
    };
  } catch {
    return {
      host: state.host ?? "127.0.0.1",
      port: state.port,
    };
  }
}

function printPlan(input: {
  readonly healthTarget: { readonly host: string; readonly port: number };
  readonly launchCommand: ReadonlyArray<string>;
  readonly logFile: string;
  readonly options: RestartOptions;
  readonly previousState: ServerRuntimeState;
  readonly runtimeStatePath: string;
}): void {
  const mode = input.options.dryRun ? "DRY RUN" : "RESTART";
  console.log(`[${mode}] runtime state: ${input.runtimeStatePath}`);
  console.log(`[${mode}] current pid: ${input.previousState.pid}`);
  console.log(`[${mode}] command: ${formatCommand(input.launchCommand)}`);
  console.log(`[${mode}] cwd: ${input.options.cwd}`);
  console.log(`[${mode}] log file: ${input.logFile}`);
  console.log(`[${mode}] health target: ${input.healthTarget.host}:${input.healthTarget.port}`);
}

async function stopServer(pid: number, options: RestartOptions): Promise<void> {
  if (!isProcessAlive(pid)) {
    console.log(`T3 server pid ${pid} is already stopped; starting a replacement.`);
    return;
  }

  console.log(`Stopping T3 server pid ${pid} with SIGTERM...`);
  process.kill(pid, "SIGTERM");
  const stopped = await waitUntil(() => !isProcessAlive(pid), options.graceMs);
  if (stopped) {
    console.log(`T3 server pid ${pid} stopped cleanly.`);
    return;
  }

  if (!options.forceKill) {
    throw new Error(
      `T3 server pid ${pid} did not stop within ${options.graceMs}ms. Rerun with --force-kill if you want SIGKILL fallback.`,
    );
  }

  console.log(`T3 server pid ${pid} did not stop in time; sending SIGKILL...`);
  process.kill(pid, "SIGKILL");
  const killed = await waitUntil(() => !isProcessAlive(pid), options.graceMs);
  if (!killed) {
    throw new Error(`T3 server pid ${pid} is still alive after SIGKILL.`);
  }
}

async function startServer(
  command: ReadonlyArray<string>,
  cwd: string,
  logFile: string,
): Promise<void> {
  await mkdir(NodePath.dirname(logFile), { recursive: true });
  await appendFile(
    logFile,
    `\n\n[${new Date().toISOString()}] Restarting T3 server: ${formatCommand(command)}\n`,
  );

  const logFd = openSync(logFile, "a");
  try {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    console.log(`Started replacement T3 server pid ${child.pid ?? "unknown"}.`);
  } finally {
    closeSync(logFd);
  }
}

async function waitForRuntimeStateRestart(
  path: string,
  previousPid: number,
  timeoutMs: number,
): Promise<ServerRuntimeState> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await readRuntimeState(path);
      if (state.pid !== previousPid && isProcessAlive(state.pid)) {
        return state;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  const details = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for runtime state to update at ${path}.${details}`);
}

async function waitForPortOpen(host: string, port: number, timeoutMs: number): Promise<void> {
  const opened = await waitUntil(async () => canConnect(host, port), timeoutMs);
  if (!opened) {
    throw new Error(`Timed out waiting for ${host}:${port} to accept connections.`);
  }
}

async function canConnect(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = Net.createConnection({ host, port });
    const finish = (value: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function formatCommand(command: ReadonlyArray<string>): string {
  return command.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`restart-t3-server failed: ${message}`);
  process.exitCode = 1;
});
