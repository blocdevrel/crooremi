import { settleAgentSignedHire } from "../x402";
import { executePayrollJob } from "../job/execute-payroll";
import {
  advanceScheduleAfterRun,
  listDueSchedules,
  markScheduleFailed,
} from "../db/schedules";
import { runX402TrafficBurst, type X402TrafficResult } from "./x402-traffic";

export type HeartbeatResult = {
  checkedAt: string;
  due: number;
  completed: number;
  failed: number;
  results: Array<{
    scheduleId: string;
    policyId: string;
    status: "completed" | "failed" | "skipped";
    jobId?: string;
    error?: string;
    x402SettlementTxHash?: string;
  }>;
  x402Traffic: X402TrafficResult;
};

/** Run due payroll schedules + x402 traffic burst. */
export async function runDueSchedules(): Promise<HeartbeatResult> {
  const due = await listDueSchedules();
  const results: HeartbeatResult["results"] = [];
  let completed = 0;
  let failed = 0;

  for (const schedule of due) {
    const clientJobId = `schedule-${schedule.id}-${Date.now()}`;
    try {
      const hire = await settleAgentSignedHire("/api/execute");
      const job = await executePayrollJob({
        policyId: schedule.policyId,
        amount: schedule.amount,
        clientJobId,
        hire,
      });
      await advanceScheduleAfterRun(schedule.id, schedule.intervalMinutes);
      completed += 1;
      results.push({
        scheduleId: schedule.id,
        policyId: schedule.policyId,
        status: "completed",
        jobId: job.jobId,
        ...(job.x402SettlementTxHash
          ? { x402SettlementTxHash: job.x402SettlementTxHash }
          : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Schedule run failed";
      await markScheduleFailed(schedule.id, message);
      failed += 1;
      results.push({
        scheduleId: schedule.id,
        policyId: schedule.policyId,
        status: "failed",
        error: message,
      });
    }
  }

  // Always run traffic after schedules (even if no due payroll).
  const x402Traffic = await runX402TrafficBurst();

  return {
    checkedAt: new Date().toISOString(),
    due: due.length,
    completed,
    failed,
    results,
    x402Traffic,
  };
}
