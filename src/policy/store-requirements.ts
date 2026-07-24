import { DEFAULT_GUIDE_TOTAL_USDC } from "./execution-guide.js";
import type { ExecuteBatchInput } from "./types.js";

const POLICY_ID_RE = /pol_[a-f0-9]+/i;

function dollarsToUsdcUnits(value: number): string {
  return String(Math.round(value * 1_000_000));
}

function parseUsdcAmount(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (Number.isInteger(value) && value >= 1000) {
      return String(value);
    }
    return dollarsToUsdcUnits(value);
  }
  return null;
}

function pickStringField(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Agent Store Instant USDC Pay: principal in checkout, recipient in requirements schema. */
export function parseAgentStoreInstantPayRequirements(
  json: unknown,
  options: { fundAmount?: string } = {},
): { to: string; amount?: string; reference?: string } | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }

  const record = json as Record<string, unknown>;
  const to = pickStringField(record, [
    "to",
    "send",
    "recipient",
    "address",
    "recipientAddress",
    "recipient_address",
    "receiver",
  ]);

  const amount =
    parseUsdcAmount(record.amount) ??
    parseUsdcAmount(record.totalUsdc) ??
    parseUsdcAmount(record.principal_amount) ??
    parseUsdcAmount(record.principalAmount) ??
    parseUsdcAmount(record.fundAmount) ??
    (options.fundAmount?.trim() ? parseUsdcAmount(options.fundAmount) : null);

  const reference = pickStringField(record, ["reference", "memo"]) ?? undefined;

  if (!to) {
    return null;
  }

  return {
    to,
    ...(amount ? { amount } : {}),
    ...(reference ? { reference } : {}),
  };
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_RE.test(value.trim());
}

/** Agent Store fund-transfer services often send only `{ "principal_amount": 1 }`. */
export function parseAgentStoreExecuteRequirements(
  json: unknown,
  options: { fundAmount?: string } = {},
): Partial<ExecuteBatchInput> | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }

  const record = json as Record<string, unknown>;
  const policyIdRaw =
    (typeof record.policyId === "string" ? record.policyId : null) ??
    (typeof record.policy_id === "string" ? record.policy_id : null);
  const policyId = policyIdRaw
    ? policyIdRaw.match(POLICY_ID_RE)?.[0]?.toLowerCase() ?? null
    : null;

  const totalUsdc =
    parseUsdcAmount(record.totalUsdc) ??
    parseUsdcAmount(record.principal_amount) ??
    parseUsdcAmount(record.principalAmount) ??
    parseUsdcAmount(record.amount) ??
    parseUsdcAmount(record.fundAmount) ??
    (options.fundAmount?.trim() ? options.fundAmount.trim() : null);

  if (!policyId && !totalUsdc) {
    return null;
  }

  return {
    ...(policyId ? { policyId } : {}),
    totalUsdc: totalUsdc ?? DEFAULT_GUIDE_TOTAL_USDC,
  };
}
