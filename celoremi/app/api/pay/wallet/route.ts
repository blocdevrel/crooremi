import { z } from "zod";
import { recordWalletInstantJob } from "@/lib/job/record-wallet-payout";
import { jsonError, jsonOk } from "@/lib/http";
import {
  buildPaymentResponseHeader,
  isHireResult,
  requireUserHirePayment,
} from "@/lib/x402";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET() {
  return serviceDiscover({
    name: "instantUsdcPayWallet",
    method: "POST",
    path: "/api/pay/wallet",
    description:
      "Record a wallet-signed tagged USDC send on Celo. Payer wallet sends directly.",
    body: {
      to: "0x…",
      amount: "10000",
      payer: "0x…",
      txHash: "0x…",
    },
    notes: ["Requires X-PAYMENT from payer wallet (x402 hire fee)"],
  });
}

const bodySchema = z.object({
  to: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export async function POST(req: Request) {
  try {
    const hire = await requireUserHirePayment(req, "/api/pay/wallet");
    if (!isHireResult(hire)) return hire;

    const body = bodySchema.parse(await req.json());
    const result = await recordWalletInstantJob({
      to: body.to,
      amount: body.amount,
      payer: body.payer,
      txHash: body.txHash,
      hire,
    });

    return jsonOk(
      {
        jobId: result.jobId,
        status: result.status,
        txHash: result.txHash,
        explorer: result.explorer,
        to: result.to,
        amount: result.amount,
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
