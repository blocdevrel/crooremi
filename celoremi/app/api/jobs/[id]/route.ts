import { CELOSCAN_TX } from "@/lib/config";
import { getJob } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const job = await getJob(id);
    if (!job) {
      return jsonOk({ error: "Job not found" }, 404);
    }
    return jsonOk({
      jobId: job.id,
      policyId: job.policyId,
      kind: job.kind,
      totalAmount: job.totalAmount,
      status: job.status,
      settlement: job.settlement,
      fundTxHash: job.fundTxHash,
      splitTxHash: job.splitTxHash,
      fundExplorer: job.fundTxHash ? CELOSCAN_TX(job.fundTxHash) : null,
      splitExplorer: job.splitTxHash ? CELOSCAN_TX(job.splitTxHash) : null,
      x402SettlementTxHash: job.x402SettlementTxHash,
      x402Explorer: job.x402SettlementTxHash
        ? CELOSCAN_TX(job.x402SettlementTxHash)
        : null,
      hireMode: job.hireMode,
      transfers: job.transfers,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    return jsonError(err);
  }
}
