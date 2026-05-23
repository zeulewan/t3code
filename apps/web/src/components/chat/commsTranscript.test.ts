import { describe, expect, it } from "vitest";

import { parseCommsTranscript } from "./commsTranscript";

describe("parseCommsTranscript", () => {
  it("parses incoming direct comms messages", () => {
    expect(parseCommsTranscript("T3 comms direct from @bob:\n\nhello Joe")).toEqual({
      direction: "from",
      messageType: "direct",
      handle: "bob",
      body: "hello Joe",
    });
  });

  it("parses outgoing notify comms messages with an inline body", () => {
    expect(parseCommsTranscript("T3 comms notify to @river: inbox only")).toEqual({
      direction: "to",
      messageType: "notify",
      handle: "river",
      body: "inbox only",
    });
  });

  it("ignores ordinary messages", () => {
    expect(parseCommsTranscript("T3 is useful, but this is not a comms transcript.")).toBeNull();
  });
});
