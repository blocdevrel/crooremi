import { z } from "zod";
import {
  executeRouterPayroll,
  isRouterConfigured,
  jobToOrderKey,
} from "@/lib/chain/router";
import { env } from "@/lib/config";
import {
  completePayoutJob,
  createPayoutJob,
  failPayoutJob,
  findIdempotentJob,
  getPolicy,
  sumCompletedAmountToday,
} from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { assertAmountWithinCaps, executePayrollTransfers } from "@/lib/payout";
import type { PolicyRecipient } from "@/lib/policy/validate";
import { isHireResult, requireHirePayment, buildPaymentResponseHeader } from "@/lib/x402";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET() {
  return serviceDiscover({
    name: "executePaymentJob",
    method: "POST",
    path: "/api/execute",
    description:
      "One hire → USDC to all policy recipients on Celo + ERC-8021 attribution + on-chain proof.",
    body: { policyId: "…", amount: "1000000" },
    notes: [
      "Requires X-PAYMENT (x402) or x-api-key",
      "amount is USDC base units (6 decimals)",
    ],
  });
}

const bodySchema = z.object({
  policyId: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  clientJobId: z.string().min(1).max(128).optional(),
});

export async function POST(req: Request) {
  try {
    const hire = await requireHirePayment(req, "/api/execute");
    if (!isHireResult(hire)) return hire;

    const body = bodySchema.parse(await req.json());
    const totalAmount = BigInt(body.amount);
    assertAmountWithinCaps(totalAmount);

    if (body.clientJobId) {
      const existing = await findIdempotentJob(
        body.policyId,
        body.amount,
        body.clientJobId,
      );
      if (existing) {
        return jsonOk({
          jobId: existing.id,
          status: existing.status,
          totalAmount: existing.totalAmount,
          transfers: existing.transfers,
          error: existing.error,
          idempotent: true,
          hireMode: hire.mode,
        });
      }
    }

    const policy = await getPolicy(body.policyId);
    if (!policy) {
      return jsonOk({ error: "Policy not found" }, 404);
    }

    const daily = await sumCompletedAmountToday();
    if (daily + totalAmount > env.MAX_DAILY_AMOUNT) {
      throw new Error(
        `Daily cap exceeded: ${daily} + ${totalAmount} > ${env.MAX_DAILY_AMOUNT}`,
      );
    }

    const recipients = policy.recipients as PolicyRecipient[];
    const job = await createPayoutJob({
      policyId: policy.id,
      kind: "payroll",
      totalAmount: body.amount,
      clientJobId: body.clientJobId,
    });

    try {
      const transfers = isRouterConfigured()
        ? (
            await executeRouterPayroll(
              recipients,
              totalAmount,
              jobToOrderKey(job.id),
            )
          ).transfers
        : await executePayrollTransfers(recipients, totalAmount);
      const settlement = isRouterConfigured()
        ? "router_payroll"
        : "wallet_payroll";
      const completed = await completePayoutJob(job.id, transfers, {
        settlement,
        ...(hire.settlementTxHash
          ? { x402SettlementTxHash: hire.settlementTxHash }
          : {}),
        hireMode: hire.mode,
      });

      return jsonOk(
        {
          jobId: completed.id,
          status: "completed",
          policyId: policy.id,
          totalAmount: body.amount,
          transfers,
          settlement,
          hireMode: hire.mode,
          ...(hire.settlementTxHash
            ? { x402SettlementTxHash: hire.settlementTxHash }
            : {}),
        },
        200,
        (() => {
          const paymentResponse = buildPaymentResponseHeader(
            hire.settlementTxHash,
          );
          return paymentResponse
            ? { "PAYMENT-RESPONSE": paymentResponse }
            : undefined;
        })(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payroll failed";
      await failPayoutJob(job.id, message);
      throw err;
    }
  } catch (err) {
    return jsonError(err);
  }
}
