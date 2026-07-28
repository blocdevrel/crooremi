import { z } from "zod";
import {
  createSchedule,
  deleteSchedule,
  listSchedulesForOwner,
  setScheduleEnabled,
} from "@/lib/db/schedules";
import { getPolicyForOwner } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { assertAmountWithinCaps } from "@/lib/payout";
import { serviceDiscover } from "@/lib/service-discover";
import { normalizeOwnerAddress } from "@/lib/wallet/owner";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("discover") === "1") {
    return serviceDiscover({
      name: "payrollSchedules",
      method: "POST",
      path: "/api/schedules",
      description:
        "Recurring tagged USDC payroll on Celo. Heartbeat POST /api/schedules/heartbeat every 20+ minutes.",
      body: {
        policyId: "…",
        amount: "1000000",
        intervalMinutes: 1440,
        name: "weekly-payroll",
      },
      notes: [
        "Minimum interval 20 minutes",
        "Fund agent USDC + keep 0.01 hire headroom per run",
        "POST /api/schedules/heartbeat?run=1 with x-api-key to execute due schedules",
      ],
    });
  }

  try {
    const ownerRaw = url.searchParams.get("owner")?.trim();
    if (!ownerRaw) {
      return jsonOk({ error: "owner query param required (wallet address)" }, 400);
    }
    const ownerAddress = normalizeOwnerAddress(ownerRaw);
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const schedules = await listSchedulesForOwner(ownerAddress, limit);
    return jsonOk({
      schedules: schedules.map((s) => ({
        scheduleId: s.id,
        policyId: s.policyId,
        policyName: s.policy?.name ?? null,
        name: s.name,
        amount: s.amount,
        intervalMinutes: s.intervalMinutes,
        enabled: s.enabled,
        runCount: s.runCount,
        lastRunAt: s.lastRunAt,
        nextRunAt: s.nextRunAt,
        lastError: s.lastError,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

const bodySchema = z.object({
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  policyId: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  intervalMinutes: z.number().int().min(20).max(43_200),
  name: z.string().min(1).max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    assertAmountWithinCaps(BigInt(body.amount));

    const ownerAddress = normalizeOwnerAddress(body.ownerAddress);
    const policy = await getPolicyForOwner(body.policyId, ownerAddress);
    if (!policy) {
      return jsonOk({ error: "Policy not found for this wallet" }, 404);
    }

    const schedule = await createSchedule(body);
    return jsonOk(
      {
        scheduleId: schedule.id,
        policyId: schedule.policyId,
        amount: schedule.amount,
        intervalMinutes: schedule.intervalMinutes,
        enabled: schedule.enabled,
        nextRunAt: schedule.nextRunAt,
        name: schedule.name,
      },
      201,
    );
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = z
      .object({
        scheduleId: z.string().min(1),
        enabled: z.boolean(),
      })
      .parse(await req.json());

    const updated = await setScheduleEnabled(body.scheduleId, body.enabled);
    return jsonOk({
      scheduleId: updated.id,
      enabled: updated.enabled,
      nextRunAt: updated.nextRunAt,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const scheduleId = url.searchParams.get("scheduleId");
    if (!scheduleId) {
      return jsonOk({ error: "scheduleId query param required" }, 400);
    }
    await deleteSchedule(scheduleId);
    return jsonOk({ ok: true, scheduleId });
  } catch (err) {
    return jsonError(err);
  }
}
