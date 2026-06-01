import { describe, expect, it } from "vitest";

import {
  chooseNextThreadIdentity,
  countThreadsUsingIdentity,
  THREAD_IDENTITY_PRESETS,
} from "./threadIdentity.ts";

describe("chooseNextThreadIdentity", () => {
  it("prefers an unused icon before reusing a preset", () => {
    expect(
      chooseNextThreadIdentity([
        { identity: THREAD_IDENTITY_PRESETS[0] },
        { identity: THREAD_IDENTITY_PRESETS[0] },
      ]),
    ).toEqual(THREAD_IDENTITY_PRESETS[1]);
  });

  it("ignores deleted threads when reserving icons", () => {
    expect(
      chooseNextThreadIdentity([
        { deletedAt: "2026-06-01T00:00:00.000Z", identity: THREAD_IDENTITY_PRESETS[0] },
      ]),
    ).toEqual(THREAD_IDENTITY_PRESETS[0]);
  });

  it("falls back to the least-used preset once every icon is taken", () => {
    expect(
      chooseNextThreadIdentity([
        ...THREAD_IDENTITY_PRESETS.map((identity) => ({ identity })),
        { identity: THREAD_IDENTITY_PRESETS[0] },
      ]),
    ).toEqual(THREAD_IDENTITY_PRESETS[1]);
  });
});

describe("countThreadsUsingIdentity", () => {
  it("counts active matching presets across the candidate set", () => {
    expect(
      countThreadsUsingIdentity({
        identity: THREAD_IDENTITY_PRESETS[0],
        threads: [
          { identity: THREAD_IDENTITY_PRESETS[0] },
          { identity: THREAD_IDENTITY_PRESETS[0] },
          { deletedAt: "2026-06-01T00:00:00.000Z", identity: THREAD_IDENTITY_PRESETS[0] },
          { identity: THREAD_IDENTITY_PRESETS[1] },
        ],
      }),
    ).toBe(2);
  });
});
