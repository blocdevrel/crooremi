import { describe, expect, it } from "vitest";
import {
  BPS_TOTAL,
  computeSplitAmounts,
  validateRecipients,
} from "./validate";

describe("policy validation", () => {
  it("accepts bps summing to 10000", () => {
    const recipients = validateRecipients([
      { address: "0x1111111111111111111111111111111111111111", bps: 6000 },
      { address: "0x2222222222222222222222222222222222222222", bps: 4000 },
    ]);
    expect(recipients).toHaveLength(2);
    expect(recipients.reduce((s, r) => s + r.bps, 0)).toBe(BPS_TOTAL);
  });

  it("rejects bad bps sum", () => {
    expect(() =>
      validateRecipients([
        { address: "0x1111111111111111111111111111111111111111", bps: 5000 },
      ]),
    ).toThrow(/sum to 10000/);
  });

  it("splits with remainder on last recipient", () => {
    const recipients = validateRecipients([
      { address: "0x1111111111111111111111111111111111111111", bps: 3333 },
      { address: "0x2222222222222222222222222222222222222222", bps: 3333 },
      { address: "0x3333333333333333333333333333333333333333", bps: 3334 },
    ]);
    const total = 100n;
    const legs = computeSplitAmounts(recipients, total);
    const sum = legs.reduce((s, l) => s + l.amount, 0n);
    expect(sum).toBe(total);
  });
});
