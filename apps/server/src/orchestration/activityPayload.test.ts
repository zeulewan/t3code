import { describe, expect, it } from "vitest";

import {
  compactThreadActivityPayload,
  compactThreadActivityPayloadData,
} from "./activityPayload.ts";

describe("compactThreadActivityPayloadData", () => {
  it("removes Codex aggregated command output while preserving compact metadata", () => {
    const compacted = compactThreadActivityPayloadData({
      item: {
        id: "call-1",
        type: "commandExecution",
        command: "rg backfill",
        aggregatedOutput: "large output".repeat(1_000),
      },
      threadId: "thread-1",
    });

    expect(compacted).toEqual({
      item: {
        id: "call-1",
        type: "commandExecution",
        command: "rg backfill",
      },
      threadId: "thread-1",
    });
  });

  it("returns unchanged non-Codex-shaped payload data", () => {
    const data = { rawOutput: { content: "short output" } };

    expect(compactThreadActivityPayloadData(data)).toBe(data);
  });

  it("compacts the nested data field on full activity payloads", () => {
    const compacted = compactThreadActivityPayload({
      itemType: "command_execution",
      data: {
        item: {
          command: "tail server.log",
          aggregatedOutput: "large output",
        },
      },
    });

    expect(compacted).toEqual({
      itemType: "command_execution",
      data: {
        item: {
          command: "tail server.log",
        },
      },
    });
  });
});
