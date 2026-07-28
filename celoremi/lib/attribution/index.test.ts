import { describe, expect, it } from "vitest";
import { toDataSuffix } from "@celo/attribution-tags";

describe("attribution", () => {
  it("encodes a celo_ tag suffix", () => {
    const suffix = toDataSuffix("celo_aabbccddeeff");
    expect(suffix.startsWith("0x")).toBe(true);
    expect(suffix.length).toBeGreaterThan(20);
  });
});
