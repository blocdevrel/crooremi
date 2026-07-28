import { withDb } from "../db";

export type CreateScheduleInput = {
  policyId: string;
  amount: string;
  intervalMinutes: number;
  name?: string;
};

function computeNextRun(intervalMinutes: number, from = new Date()): Date {
  return new Date(from.getTime() + intervalMinutes * 60_000);
}

export async function createSchedule(input: CreateScheduleInput) {
  const intervalMinutes = Math.max(20, Math.min(input.intervalMinutes, 43_200));
  return withDb((db) =>
    db.payrollSchedule.create({
      data: {
        policyId: input.policyId,
        amount: input.amount,
        intervalMinutes,
        name: input.name ?? null,
        enabled: true,
        nextRunAt: new Date(),
      },
    }),
  );
}

export async function listSchedules(limit = 50) {
  return withDb((db) =>
    db.payrollSchedule.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        policy: { select: { name: true, recipients: true } },
      },
    }),
  );
}

export async function listDueSchedules() {
  const now = new Date();
  return withDb((db) =>
    db.payrollSchedule.findMany({
      where: {
        enabled: true,
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      orderBy: { nextRunAt: "asc" },
      take: 20,
    }),
  );
}

export async function advanceScheduleAfterRun(id: string, intervalMinutes: number) {
  return withDb((db) =>
    db.payrollSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: computeNextRun(intervalMinutes),
        lastError: null,
        runCount: { increment: 1 },
      },
    }),
  );
}

export async function markScheduleFailed(id: string, error: string) {
  return withDb((db) =>
    db.payrollSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastError: error.slice(0, 500),
      },
    }),
  );
}

export async function setScheduleEnabled(id: string, enabled: boolean) {
  return withDb((db) =>
    db.payrollSchedule.update({
      where: { id },
      data: {
        enabled,
        ...(enabled ? { nextRunAt: new Date() } : {}),
      },
    }),
  );
}

export async function deleteSchedule(id: string) {
  return withDb((db) => db.payrollSchedule.delete({ where: { id } }));
}
