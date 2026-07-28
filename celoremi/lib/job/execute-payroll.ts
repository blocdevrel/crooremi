import {
  executeRouterPayroll,
  isRouterConfigured,
  jobToOrderKey,
} from "../chain/router";
import { env } from "../config";
import {
  completePayoutJob,
  createPayoutJob,
  failPayoutJob,
  findIdempotentJob,
  getPolicy,
  sumCompletedAmountToday,
} from "../db";
import { assertAmountWithinCaps, executePayrollTransfers } from "../payout";
import type { PolicyRecipient } from "../policy/validate";
import type { HireResult } from "../x402";

export type ExecutePayrollInput = {
  policyId: string;
  amount: string;
  clientJobId?: string;
  hire: HireResult;
};

export type ExecutePayrollResult = {
  jobId: string;
  status: string;
  policyId: string;
  totalAmount: string;
  transfers: Awaited<ReturnType<typeof executePayrollTransfers>>;
  settlement: string;
  hireMode: HireResult["mode"];
  x402SettlementTxHash?: string;
  idempotent?: boolean;
};

export async function executePayrollJob(
  input: ExecutePayrollInput,
): Promise<ExecutePayrollResult> {
  const totalAmount = BigInt(input.amount);
  assertAmountWithinCaps(totalAmount);

  if (input.clientJobId) {
    const existing = await findIdempotentJob(
      input.policyId,
      input.amount,
      input.clientJobId,
    );
    if (existing) {
      return {
        jobId: existing.id,
        status: existing.status,
        policyId: input.policyId,
        totalAmount: existing.totalAmount,
        transfers: (existing.transfers as ExecutePayrollResult["transfers"]) ?? [],
        settlement: existing.settlement ?? "wallet_payroll",
        hireMode: input.hire.mode,
        idempotent: true,
      };
    }
  }

  const policy = await getPolicy(input.policyId);
  if (!policy) {
    throw new Error("Policy not found");
  }

  const daily = await sumCompletedAmountToday();
  if (daily + totalAmount > env.MAX_DAILY_AMOUNT) {
    throw new Error(
      `Daily cap exceeded: ${daily} + ${totalAmount} > ${env.MAX_DAILY_AMOUNT}`,
    );
  }

  const recipients = policy.recipients as PolicyRecipient[];
  const job = await createPayoutJob({
    policyId: policy.id,
    kind: "payroll",
    totalAmount: input.amount,
    clientJobId: input.clientJobId,
  });

  try {
    const transfers = isRouterConfigured()
      ? (
          await executeRouterPayroll(
            recipients,
            totalAmount,
            jobToOrderKey(job.id),
          )
        ).transfers
      : await executePayrollTransfers(recipients, totalAmount);
    const settlement = isRouterConfigured()
      ? "router_payroll"
      : "wallet_payroll";

    await completePayoutJob(job.id, transfers, {
      settlement,
      ...(input.hire.settlementTxHash
        ? { x402SettlementTxHash: input.hire.settlementTxHash }
        : {}),
      hireMode: input.hire.mode,
    });

    return {
      jobId: job.id,
      status: "completed",
      policyId: policy.id,
      totalAmount: input.amount,
      transfers,
      settlement,
      hireMode: input.hire.mode,
      ...(input.hire.settlementTxHash
        ? { x402SettlementTxHash: input.hire.settlementTxHash }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payroll failed";
    await failPayoutJob(job.id, message);
    throw err;
  }
}
