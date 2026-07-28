import { z } from "zod";
import { buildSplitQuote } from "@/lib/job/quote";
import { jsonError, jsonOk } from "@/lib/http";
import {
  buildPaymentResponseHeader,
  isHireResult,
  requireHirePayment,
} from "@/lib/x402";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("discover") === "1") {
    return serviceDiscover({
      name: "splitQuote",
      method: "GET",
      path: "/api/quote",
      description:
        "x402-gated USDC split preview for agent planners. Hire Remifi before executing payroll.",
      body: { policyId: "…", amount: "1000000" },
      notes: [
        "Requires X-PAYMENT (x402) — counts toward Track 2",
        "Use POST /api/execute to settle tagged USDC on Celo (Track 1)",
        "amount is USDC base units (6 decimals)",
      ],
    });
  }

  try {
    const hire = await requireHirePayment(req, "/api/quote");
    if (!isHireResult(hire)) return hire;

    const query = z
      .object({
        policyId: z.string().min(1),
        amount: z.string().regex(/^\d+$/),
      })
      .parse({
        policyId: url.searchParams.get("policyId"),
        amount: url.searchParams.get("amount"),
      });

    const quote = await buildSplitQuote(query.policyId, query.amount);

    return jsonOk(
      {
        ...quote,
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
    return jsonError(err);
  }
}
