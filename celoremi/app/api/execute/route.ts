import { z } from "zod";
import { executePayrollJob } from "@/lib/job/execute-payroll";
import { jsonError, jsonOk } from "@/lib/http";
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
    const result = await executePayrollJob({
      policyId: body.policyId,
      amount: body.amount,
      clientJobId: body.clientJobId,
      hire,
    });

    if (result.idempotent) {
      return jsonOk({
        jobId: result.jobId,
        status: result.status,
        totalAmount: result.totalAmount,
        transfers: result.transfers,
        idempotent: true,
        hireMode: result.hireMode,
      });
    }

    return jsonOk(
      {
        jobId: result.jobId,
        status: result.status,
        policyId: result.policyId,
        totalAmount: result.totalAmount,
        transfers: result.transfers,
        settlement: result.settlement,
        hireMode: result.hireMode,
        ...(result.x402SettlementTxHash
          ? { x402SettlementTxHash: result.x402SettlementTxHash }
          : {}),
      },
      200,
      (() => {
        const paymentResponse = buildPaymentResponseHeader(
          result.x402SettlementTxHash,
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
