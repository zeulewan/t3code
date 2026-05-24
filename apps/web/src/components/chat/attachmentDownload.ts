import type { EnvironmentId } from "@t3tools/contracts";

import { readSavedEnvironmentBearerToken } from "../../environments/runtime/catalog";

export class AttachmentDownloadError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AttachmentDownloadError";
    this.status = status;
  }
}

async function readDownloadErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim() || fallbackMessage;
}

export async function fetchAttachmentBlob(input: {
  readonly environmentId: EnvironmentId;
  readonly url: string;
  readonly fetchImpl?: typeof fetch;
  readonly readBearerToken?: typeof readSavedEnvironmentBearerToken;
}): Promise<Blob> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const readBearerToken = input.readBearerToken ?? readSavedEnvironmentBearerToken;
  const bearerToken = await readBearerToken(input.environmentId).catch(() => null);

  const requestInit: RequestInit = { credentials: "same-origin" };
  if (bearerToken) {
    requestInit.headers = { authorization: `Bearer ${bearerToken}` };
  }

  const response = await fetchImpl(input.url, requestInit);

  if (!response.ok) {
    throw new AttachmentDownloadError(
      await readDownloadErrorMessage(
        response,
        `Attachment download failed with HTTP ${response.status}.`,
      ),
      response.status,
    );
  }

  return response.blob();
}

export function saveBlobAsFile(input: {
  readonly blob: Blob;
  readonly fileName: string;
  readonly documentRef?: Document;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
  readonly scheduleRevoke?: (callback: () => void) => void;
}): void {
  const documentRef = input.documentRef ?? document;
  const createObjectUrl = input.createObjectUrl ?? URL.createObjectURL.bind(URL);
  const revokeObjectUrl = input.revokeObjectUrl ?? URL.revokeObjectURL.bind(URL);
  const objectUrl = createObjectUrl(input.blob);
  const anchor = documentRef.createElement("a");
  anchor.href = objectUrl;
  anchor.download = input.fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  const root = documentRef.body ?? documentRef.documentElement;
  if (!root) {
    revokeObjectUrl(objectUrl);
    throw new AttachmentDownloadError("Unable to start attachment download.");
  }

  root.appendChild(anchor);
  anchor.click();
  anchor.remove();

  const scheduleRevoke =
    input.scheduleRevoke ?? ((callback: () => void) => window.setTimeout(callback, 1_000));
  scheduleRevoke(() => revokeObjectUrl(objectUrl));
}

export async function downloadAttachment(input: {
  readonly environmentId: EnvironmentId;
  readonly url: string;
  readonly fileName: string;
}): Promise<void> {
  const blob = await fetchAttachmentBlob({
    environmentId: input.environmentId,
    url: input.url,
  });
  saveBlobAsFile({
    blob,
    fileName: input.fileName,
  });
}
