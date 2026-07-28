import { describe, expect, it } from "vitest";
import { renormalizeBpsToTotal } from "./llm";
import { BPS_TOTAL } from "./validate";

describe("renormalizeBpsToTotal", () => {
  it("leaves exact totals alone", () => {
    const out = renormalizeBpsToTotal([
      { bps: 6000 },
      { bps: 4000 },
    ]);
    expect(out.map((r) => r.bps)).toEqual([6000, 4000]);
  });

  it("scales partial shares to BPS_TOTAL", () => {
    const out = renormalizeBpsToTotal([
      { bps: 3000 },
      { bps: 6000 },
    ]);
    expect(out.reduce((s, r) => s + r.bps, 0)).toBe(BPS_TOTAL);
    expect(out[0]!.bps).toBe(3333);
    expect(out[1]!.bps).toBe(6667);
  });
});
