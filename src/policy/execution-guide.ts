import { env } from "../config.js";
import { amountFromBps } from "./bps.js";
import type { CreatePolicyDelivery, ExecutionGuide } from "./types.js";

export const DEFAULT_GUIDE_TOTAL_USDC = "1000000";

export const EXECUTE_SERVICE_FEE_USDC = "1000000";

export function buildExecutionGuide(
  delivery: Pick<
    CreatePolicyDelivery,
    "policyId" | "policy" | "remainderBps" | "allocatedBps"
  >,
  totalUsdc: string = DEFAULT_GUIDE_TOTAL_USDC,
): ExecutionGuide {
  const principal = BigInt(totalUsdc);
  const fee = BigInt(EXECUTE_SERVICE_FEE_USDC);
  const fundAmount = amountFromBps(principal, delivery.allocatedBps);

  const recipients = delivery.policy.recipients.map((recipient) => {
    const amount = amountFromBps(principal, recipient.bps);
    return {
      label: recipient.label,
      address: recipient.address,
      bps: recipient.bps,
      amount: amount.toString(),
    };
  });

  return {
    totalUsdc,
    payroll: {
      requirements: {
        policyId: delivery.policyId,
        totalUsdc,
      },
      fundAmount: fundAmount.toString(),
      fundToken: env.USDC_ADDRESS,
      serviceFeeUsdc: EXECUTE_SERVICE_FEE_USDC,
      estimatedPayUsdc: (fundAmount + fee).toString(),
      recipientCount: recipients.length,
      recipients,
      note:
        "Hire USDC Split Execution once. Set fund amount to payroll.fundAmount " +
        "and fund token to Base USDC. After payOrder, Remifi transfers USDC to each recipient on Base.",
    },
    ...(delivery.remainderBps > 0 ? { remainderBps: delivery.remainderBps } : {}),
  };
}
