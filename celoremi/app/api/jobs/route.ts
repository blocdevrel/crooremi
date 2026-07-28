import { CELOSCAN_TX } from "@/lib/config";
import { listRecentJobs } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { serviceDiscover } from "@/lib/service-discover";

function jobToProof(job: Awaited<ReturnType<typeof listRecentJobs>>[number]) {
  const transfers = Array.isArray(job.transfers)
    ? (job.transfers as Array<{
        to: string;
        amount: string;
        txHash?: string;
        explorer?: string;
        label?: string;
      }>)
    : [];

  return {
    jobId: job.id,
    policyId: job.policyId,
    policyName: job.policy?.name ?? null,
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
    transfers: transfers.map((t) => ({
      ...t,
      explorer: t.explorer ?? (t.txHash ? CELOSCAN_TX(t.txHash) : undefined),
    })),
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("discover") === "1") {
    return serviceDiscover({
      name: "listJobProof",
      method: "GET",
      path: "/api/jobs",
      description:
        "List recent completed payout jobs with transfer hashes and Celoscan links for all users.",
      notes: [
        "Optional ?limit=50 (max 100)",
        "Single job: GET /api/jobs/:id",
      ],
    });
  }

  try {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const jobs = await listRecentJobs(limit);
    return jsonOk({ jobs: jobs.map(jobToProof) });
  } catch (err) {
    return jsonError(err);
  }
}
