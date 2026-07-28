import { PrismaClient, Prisma } from "@prisma/client";
import type { PolicyRecipient } from "../policy/validate";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon pooler + Prisma: enable pgbouncer mode, drop channel_binding
 * (breaks Prisma through PgBouncer), keep connection_limit low for Next.js.
 */
function neonAwareDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    if (u.hostname.includes("-pooler")) {
      u.searchParams.set("pgbouncer", "true");
      u.searchParams.delete("channel_binding");
      if (!u.searchParams.has("connection_limit")) {
        u.searchParams.set("connection_limit", "1");
      }
      if (!u.searchParams.has("connect_timeout")) {
        u.searchParams.set("connect_timeout", "15");
      }
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

function createPrismaClient() {
  const url = neonAwareDatabaseUrl(process.env.DATABASE_URL);
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(url ? { datasources: { db: { url } } } : {}),
  });
}

// Dev HMR can keep a stale client after Neon closes the socket — recreate on reload.
if (process.env.NODE_ENV !== "production" && globalForPrisma.prisma) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(err.code);
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /closed|connection|timed out|can't reach|ECONNRESET|server has closed/i.test(
    msg,
  );
}

/** Run a DB op; reconnect + retry once on Neon idle / closed connections. */
export async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  try {
    return await fn(prisma);
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    console.warn(
      "[remifi] DB connection lost; reconnecting…",
      err instanceof Error ? err.message : err,
    );
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    try {
      await prisma.$connect();
    } catch (connectErr) {
      console.error("[remifi] DB reconnect failed", connectErr);
      throw err;
    }
    return fn(prisma);
  }
}

export type CreatePolicyInput = {
  name?: string;
  recipients: PolicyRecipient[];
  ownerAddress: string;
};

export async function createPolicy(input: CreatePolicyInput) {
  return withDb((db) =>
    db.policy.create({
      data: {
        name: input.name ?? null,
        recipients: input.recipients,
        ownerAddress: input.ownerAddress.toLowerCase(),
      },
    }),
  );
}

export async function getPolicy(id: string) {
  return withDb((db) => db.policy.findUnique({ where: { id } }));
}

export async function getPolicyForOwner(id: string, ownerAddress: string) {
  const owner = ownerAddress.toLowerCase();
  return withDb((db) =>
    db.policy.findFirst({
      where: { id, ownerAddress: owner },
    }),
  );
}

export async function listPoliciesForOwner(ownerAddress: string, limit = 30) {
  const owner = ownerAddress.toLowerCase();
  return withDb((db) =>
    db.policy.findMany({
      where: { ownerAddress: owner },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        name: true,
        recipients: true,
        ownerAddress: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  );
}

/** @deprecated Use listPoliciesForOwner — policies are wallet-scoped. */
export async function listPolicies(limit = 30) {
  return withDb((db) =>
    db.policy.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        name: true,
        recipients: true,
        ownerAddress: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  );
}

export type JobTransfer = {
  to: string;
  amount: string;
  txHash: string;
  explorer?: string;
  label?: string;
};

export async function findIdempotentJob(
  policyId: string,
  totalAmount: string,
  clientJobId: string,
) {
  return withDb((db) =>
    db.payoutJob.findUnique({
      where: {
        policyId_totalAmount_clientJobId: {
          policyId,
          totalAmount,
          clientJobId,
        },
      },
    }),
  );
}

export async function createPayoutJob(data: {
  policyId?: string;
  kind: "payroll" | "instant";
  totalAmount: string;
  clientJobId?: string;
}) {
  return withDb((db) =>
    db.payoutJob.create({
      data: {
        policyId: data.policyId ?? null,
        kind: data.kind,
        totalAmount: data.totalAmount,
        status: "pending",
        clientJobId: data.clientJobId ?? null,
      },
    }),
  );
}

export type CompletePayoutMeta = {
  settlement?: string;
  fundTxHash?: string;
  splitTxHash?: string;
  x402SettlementTxHash?: string;
  hireMode?: string;
};

export async function completePayoutJob(
  id: string,
  transfers: JobTransfer[],
  meta?: CompletePayoutMeta,
) {
  return withDb((db) =>
    db.payoutJob.update({
      where: { id },
      data: {
        status: "completed",
        transfers,
        completedAt: new Date(),
        error: null,
        ...(meta?.settlement ? { settlement: meta.settlement } : {}),
        ...(meta?.fundTxHash ? { fundTxHash: meta.fundTxHash } : {}),
        ...(meta?.splitTxHash ? { splitTxHash: meta.splitTxHash } : {}),
        ...(meta?.x402SettlementTxHash
          ? { x402SettlementTxHash: meta.x402SettlementTxHash }
          : {}),
        ...(meta?.hireMode ? { hireMode: meta.hireMode } : {}),
      },
    }),
  );
}

export async function failPayoutJob(
  id: string,
  error: string,
  transfers?: JobTransfer[],
) {
  return withDb((db) =>
    db.payoutJob.update({
      where: { id },
      data: {
        status: "failed",
        error,
        ...(transfers ? { transfers } : {}),
        completedAt: new Date(),
      },
    }),
  );
}

export async function getJob(id: string) {
  return withDb((db) => db.payoutJob.findUnique({ where: { id } }));
}

export async function listRecentJobs(limit = 50) {
  return withDb((db) =>
    db.payoutJob.findMany({
      where: { status: "completed" },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      include: { policy: { select: { name: true } } },
    }),
  );
}

/** Sum of completed job totals since start of UTC day (for daily cap). */
export async function sumCompletedAmountToday(): Promise<bigint> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const rows = await withDb((db) =>
    db.payoutJob.findMany({
      where: {
        status: "completed",
        completedAt: { gte: start },
      },
      select: { totalAmount: true },
    }),
  );

  return rows.reduce((sum, row) => sum + BigInt(row.totalAmount), 0n);
}
