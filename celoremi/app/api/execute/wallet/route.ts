import { z } from "zod";
import { recordWalletPayrollJob } from "@/lib/job/record-wallet-payout";
import { jsonError, jsonOk } from "@/lib/http";
import {
  buildPaymentResponseHeader,
  isHireResult,
  requireUserHirePayment,
} from "@/lib/x402";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET() {
  return serviceDiscover({
    name: "executePaymentJobWallet",
    method: "POST",
    path: "/api/execute/wallet",
    description:
      "Record wallet-signed tagged USDC payroll on Celo. User wallet sends; agent wallet not used.",
    body: {
      policyId: "…",
      amount: "1000000",
      payer: "0x…",
      transfers: [{ to: "0x…", amount: "600000", txHash: "0x…" }],
    },
    notes: [
      "Requires X-PAYMENT from payer wallet (x402 hire fee)",
      "Each transfer must include ERC-8021 attribution tag",
    ],
  });
}

const transferSchema = z.object({
  to: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const bodySchema = z.object({
  policyId: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  transfers: z.array(transferSchema).min(1).max(20),
  clientJobId: z.string().min(1).max(128).optional(),
});

export async function POST(req: Request) {
  try {
    const hire = await requireUserHirePayment(req, "/api/execute/wallet");
    if (!isHireResult(hire)) return hire;

    const body = bodySchema.parse(await req.json());
    const result = await recordWalletPayrollJob({
      policyId: body.policyId,
      amount: body.amount,
      payer: body.payer,
      transfers: body.transfers,
      clientJobId: body.clientJobId,
      hire,
    });

    if ("idempotent" in result && result.idempotent) {
      return jsonOk({
        jobId: result.jobId,
        status: result.status,
        totalAmount: result.totalAmount,
        transfers: result.transfers,
        settlement: result.settlement,
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
        payer: result.payer,
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
