import * as Effect from "effect/Effect";

import { ClientTracingLive } from "../observability/clientTracing";
import type { WsConnectionStatus } from "./wsConnectionState";

type WsDiagnosticEvent = "close" | "error" | "heartbeat-timeout";

interface BrowserNetworkInformation {
  readonly downlink?: number;
  readonly effectiveType?: string;
  readonly rtt?: number;
  readonly saveData?: boolean;
}

interface WsDiagnosticInput {
  readonly event: WsDiagnosticEvent;
  readonly status: WsConnectionStatus;
  readonly code?: number | null;
  readonly reason?: string | null;
  readonly error?: string | null;
  readonly intentional?: boolean;
}

function getBrowserNetworkInformation(): BrowserNetworkInformation | undefined {
  const connection = (
    globalThis.navigator as Navigator & {
      readonly connection?: BrowserNetworkInformation;
    }
  )?.connection;
  return connection;
}

function normalizeStringAttribute(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function buildDiagnosticAttributes(input: WsDiagnosticInput): Record<string, unknown> {
  const network = getBrowserNetworkInformation();
  return {
    "ws.event": input.event,
    "ws.phase": input.status.phase,
    "ws.has_connected": input.status.hasConnected,
    "ws.online": input.status.online,
    "ws.reconnect_phase": input.status.reconnectPhase,
    "ws.reconnect_attempt_count": input.status.reconnectAttemptCount,
    "ws.attempt_count": input.status.attemptCount,
    ...(input.status.socketUrl ? { "ws.url": input.status.socketUrl } : {}),
    ...(input.status.connectionLabel
      ? { "ws.connection_label": input.status.connectionLabel }
      : {}),
    ...(input.code !== undefined && input.code !== null ? { "ws.close_code": input.code } : {}),
    ...(normalizeStringAttribute(input.reason)
      ? { "ws.close_reason": normalizeStringAttribute(input.reason) }
      : {}),
    ...(normalizeStringAttribute(input.error)
      ? { "ws.error": normalizeStringAttribute(input.error) }
      : {}),
    ...(input.intentional !== undefined ? { "ws.close_intentional": input.intentional } : {}),
    ...(network?.effectiveType ? { "network.effective_type": network.effectiveType } : {}),
    ...(typeof network?.downlink === "number" ? { "network.downlink_mbps": network.downlink } : {}),
    ...(typeof network?.rtt === "number" ? { "network.rtt_ms": network.rtt } : {}),
    ...(typeof network?.saveData === "boolean" ? { "network.save_data": network.saveData } : {}),
  };
}

export function recordWsLifecycleDiagnostic(input: WsDiagnosticInput): void {
  const attributes = buildDiagnosticAttributes(input);
  Effect.runFork(
    Effect.logInfo("WebSocket client lifecycle diagnostic").pipe(
      Effect.withSpan("t3.web.websocket.lifecycle", { attributes }),
      Effect.provide(ClientTracingLive),
    ),
  );
}
