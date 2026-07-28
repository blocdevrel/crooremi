import { z } from "zod";
import { env } from "@/lib/config";
import {
  completePayoutJob,
  createPayoutJob,
  failPayoutJob,
  sumCompletedAmountToday,
} from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import {
  assertAmountWithinCaps,
  sendTaggedUsdcTransfer,
} from "@/lib/payout";
import { resolveAddressInput } from "@/lib/ens/resolve";
import { isHireResult, requireHirePayment, buildPaymentResponseHeader } from "@/lib/x402";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET() {
  return serviceDiscover({
    name: "instantUsdcPay",
    method: "POST",
    path: "/api/pay",
    description:
      "x402 hire + tagged USDC to any wallet or ENS / Base name.",
    body: { to: "vitalik.eth", amount: "10000" },
    notes: ["Requires X-PAYMENT (x402) or x-api-key", "amount is USDC base units (6 decimals)"],
  });
}

const bodySchema = z.object({
  to: z.string(),
  amount: z.string().regex(/^\d+$/),
});

export async function POST(req: Request) {
  try {
    const hire = await requireHirePayment(req, "/api/pay");
    if (!isHireResult(hire)) return hire;

    const body = bodySchema.parse(await req.json());
    const resolved = await resolveAddressInput(body.to);
    const to = resolved.address;
    const amount = BigInt(body.amount);
    assertAmountWithinCaps(amount);

    const daily = await sumCompletedAmountToday();
    if (daily + amount > env.MAX_DAILY_AMOUNT) {
      throw new Error(
        `Daily cap exceeded: ${daily} + ${amount} > ${env.MAX_DAILY_AMOUNT}`,
      );
    }

    const job = await createPayoutJob({
      kind: "instant",
      totalAmount: body.amount,
    });

    try {
      const result = await sendTaggedUsdcTransfer(to, amount);
      const transfer = {
        to: result.to,
        amount: result.amount.toString(),
        txHash: result.txHash,
        explorer: result.explorer,
      };
      await completePayoutJob(job.id, [transfer], {
        settlement: "instant",
        ...(hire.settlementTxHash
          ? { x402SettlementTxHash: hire.settlementTxHash }
          : {}),
        hireMode: hire.mode,
      });

      return jsonOk(
        {
          jobId: job.id,
          status: "completed",
          txHash: result.txHash,
          explorer: result.explorer,
          to: result.to,
          ens: resolved.ens ?? null,
          amount: result.amount.toString(),
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
      const message = err instanceof Error ? err.message : "Instant pay failed";
      await failPayoutJob(job.id, message);
      throw err;
    }
  } catch (err) {
    return jsonError(err);
  }
}
