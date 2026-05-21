export const SUPPORTED_PROVIDER_IMAGE_INPUT_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const SUPPORTED_PROVIDER_IMAGE_INPUT_MIME_TYPE_SET = new Set<string>(
  SUPPORTED_PROVIDER_IMAGE_INPUT_MIME_TYPES,
);

export function normalizeAttachmentMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase();
}

export function isSupportedProviderImageInputMimeType(mimeType: string): boolean {
  return SUPPORTED_PROVIDER_IMAGE_INPUT_MIME_TYPE_SET.has(normalizeAttachmentMimeType(mimeType));
}

export function supportedProviderImageInputMimeTypesLabel(): string {
  return SUPPORTED_PROVIDER_IMAGE_INPUT_MIME_TYPES.join(", ");
}
