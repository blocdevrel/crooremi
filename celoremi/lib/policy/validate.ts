import { getAddress, isAddress, type Hex } from "viem";

export const BPS_TOTAL = 10_000;
export const MAX_RECIPIENTS = 20;

export type PolicyRecipient = {
  address: `0x${string}`;
  bps: number;
  label?: string;
};

export type SplitAmounts = Array<{
  address: `0x${string}`;
  label?: string;
  bps: number;
  amount: bigint;
}>;

export function normalizeAddress(raw: string): `0x${string}` {
  if (!isAddress(raw)) {
    throw new Error(`Invalid address: ${raw}`);
  }
  return getAddress(raw) as `0x${string}`;
}

export function validateRecipients(
  recipients: Array<{ address: string; bps: number; label?: string }>,
): PolicyRecipient[] {
  if (recipients.length === 0) {
    throw new Error("Policy must include at least one recipient");
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(`Max ${MAX_RECIPIENTS} recipients per policy`);
  }

  const seen = new Set<string>();
  const normalized: PolicyRecipient[] = [];

  for (const r of recipients) {
    if (!Number.isInteger(r.bps) || r.bps <= 0) {
      throw new Error(`bps must be a positive integer, got ${r.bps}`);
    }
    const address = normalizeAddress(r.address);
    const key = address.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate recipient address: ${address}`);
    }
    seen.add(key);
    normalized.push({
      address,
      bps: r.bps,
      ...(r.label ? { label: r.label } : {}),
    });
  }

  const sum = normalized.reduce((acc, r) => acc + r.bps, 0);
  if (sum !== BPS_TOTAL) {
    throw new Error(`Recipient bps must sum to ${BPS_TOTAL}, got ${sum}`);
  }

  return normalized;
}

/**
 * Split totalAmount by bps. Last recipient gets remainder so sum === totalAmount.
 */
export function computeSplitAmounts(
  recipients: PolicyRecipient[],
  totalAmount: bigint,
): SplitAmounts {
  if (totalAmount <= 0n) {
    throw new Error("totalAmount must be > 0");
  }

  const amounts: SplitAmounts = [];
  let allocated = 0n;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i]!;
    const isLast = i === recipients.length - 1;
    const amount = isLast
      ? totalAmount - allocated
      : (totalAmount * BigInt(r.bps)) / BigInt(BPS_TOTAL);

    if (amount < 0n) {
      throw new Error("Computed negative amount — check totalAmount and bps");
    }

    allocated += amount;
    amounts.push({
      address: r.address,
      bps: r.bps,
      amount,
      ...(r.label ? { label: r.label } : {}),
    });
  }

  return amounts;
}

export type TransferProof = {
  to: `0x${string}`;
  amount: string;
  txHash: Hex;
  explorer: string;
  label?: string;
};
