import { getPolicy } from "../db";
import { assertAmountWithinCaps } from "../payout";
import {
  computeSplitAmounts,
  type PolicyRecipient,
} from "../policy/validate";

export async function buildSplitQuote(policyId: string, amountRaw: string) {
  const amount = BigInt(amountRaw);
  assertAmountWithinCaps(amount);

  const policy = await getPolicy(policyId);
  if (!policy) {
    throw new Error("Policy not found");
  }

  const recipients = policy.recipients as PolicyRecipient[];
  const legs = computeSplitAmounts(recipients, amount);

  return {
    policyId: policy.id,
    policyName: policy.name,
    totalAmount: amountRaw,
    recipientCount: legs.length,
    legs: legs.map((leg) => ({
      to: leg.address,
      amount: leg.amount.toString(),
      bps: leg.bps,
      ...(leg.label ? { label: leg.label } : {}),
    })),
    executePath: "POST /api/execute",
    network: "celo-mainnet",
    asset: "USDC",
  };
}
