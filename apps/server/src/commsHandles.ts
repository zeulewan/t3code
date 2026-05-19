export function makeThreadCommsHandle(input: {
  readonly title: string;
  readonly threadId: string;
}): string {
  const normalized = input.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : `thread-${input.threadId.slice(0, 8)}`;
}
