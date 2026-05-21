function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compactThreadActivityPayloadData(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }

  const item = data.item;
  if (!isRecord(item) || typeof item.aggregatedOutput !== "string") {
    return data;
  }

  const { aggregatedOutput: _aggregatedOutput, ...compactItem } = item;
  return {
    ...data,
    item: compactItem,
  };
}

export function compactThreadActivityPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const compactData = compactThreadActivityPayloadData(payload.data);
  if (compactData === payload.data) {
    return payload;
  }

  return {
    ...payload,
    data: compactData,
  };
}
