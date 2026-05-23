import type { CommsMessageType } from "@t3tools/contracts";

export type CommsTranscriptDirection = "from" | "to";

export interface ParsedCommsTranscript {
  direction: CommsTranscriptDirection;
  messageType: CommsMessageType;
  handle: string;
  body: string;
}

const COMMS_TRANSCRIPT_PREFIX_RE =
  /^T3 comms (direct|notify|defer) (from|to) @([A-Za-z0-9][A-Za-z0-9_-]*):(.*)$/s;

export function parseCommsTranscript(
  text: string | null | undefined,
): ParsedCommsTranscript | null {
  if (!text) {
    return null;
  }

  const match = COMMS_TRANSCRIPT_PREFIX_RE.exec(text);
  if (!match) {
    return null;
  }

  const [, messageType, direction, handle, rawBody] = match;
  if (!messageType || !direction || !handle || rawBody === undefined) {
    return null;
  }

  const body = (
    rawBody.startsWith("\n") ? rawBody.replace(/^\n{1,2}/, "") : rawBody.trimStart()
  ).trimEnd();
  if (body.length === 0) {
    return null;
  }

  return {
    direction: direction as CommsTranscriptDirection,
    messageType: messageType as CommsMessageType,
    handle,
    body,
  };
}
