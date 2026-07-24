export const BPS_TOTAL = 10_000;

export type BpsSummary = {
  allocatedBps: number;
  remainderBps: number;
};

export function summarizeBps(recipients: Array<{ bps: number }>): BpsSummary {
  const allocatedBps = recipients.reduce((sum, r) => sum + r.bps, 0);
  return {
    allocatedBps,
    remainderBps: BPS_TOTAL - allocatedBps,
  };
}

/** Allows partial splits (sum < 10000). Rejects over-allocation only. */
export function validateBps(recipients: Array<{ bps: number }>): BpsSummary {
  if (recipients.length === 0) {
    throw new Error("Policy must include at least one recipient");
  }
  const summary = summarizeBps(recipients);
  if (summary.allocatedBps > BPS_TOTAL) {
    throw new Error(
      `Recipient shares cannot exceed 100% (10000 bps), got ${summary.allocatedBps} bps`,
    );
  }
  return summary;
}

export function formatRemainderNote(remainderBps: number): string {
  const pct = remainderBps / 100;
  const pctLabel = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
  return (
    `${pctLabel} (${remainderBps} bps) is unallocated — it stays with the payer ` +
    "and is not included in payroll execution fund amount."
  );
}

/** USDC amount for one leg: total × (bps / 10000), integer 6-decimal units. */
export function amountFromBps(totalUsdc: bigint, bps: number): bigint {
  return (totalUsdc * BigInt(bps)) / BigInt(BPS_TOTAL);
}

export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}
