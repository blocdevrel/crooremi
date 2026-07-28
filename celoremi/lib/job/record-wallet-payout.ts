import { getAddress, type Address, type Hex } from "viem";
import { CELOSCAN_TX, env } from "../config";
import {
  completePayoutJob,
  createPayoutJob,
  failPayoutJob,
  findIdempotentJob,
  getPolicy,
  sumCompletedAmountToday,
  type JobTransfer,
} from "../db";
import { assertAmountWithinCaps } from "../payout";
import { verifyWalletUsdcTransfer } from "../payout/verify-wallet-transfer";
import {
  computeSplitAmounts,
  normalizeAddress,
  type PolicyRecipient,
} from "../policy/validate";
import { policyOwnedBy } from "../wallet/owner";
import type { HireResult } from "../x402";

export type WalletTransferInput = {
  to: string;
  amount: string;
  txHash: string;
};

export type RecordWalletPayrollInput = {
  policyId: string;
  amount: string;
  payer: string;
  transfers: WalletTransferInput[];
  clientJobId?: string;
  hire: HireResult;
};

export type RecordWalletInstantInput = {
  to: string;
  amount: string;
  payer: string;
  txHash: string;
  hire: HireResult;
};

function toJobTransfer(
  to: Address,
  amount: string,
  txHash: Hex,
  label?: string,
): JobTransfer {
  return {
    to,
    amount,
    txHash,
    explorer: CELOSCAN_TX(txHash),
    ...(label ? { label } : {}),
  };
}

export async function recordWalletPayrollJob(
  input: RecordWalletPayrollInput,
) {
  const totalAmount = BigInt(input.amount);
  assertAmountWithinCaps(totalAmount);

  const payer = normalizeAddress(input.payer);

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
        transfers:
          (existing.transfers as JobTransfer[] | null) ?? [],
        settlement: existing.settlement ?? "wallet_sender",
        hireMode: input.hire.mode,
        payer,
        idempotent: true as const,
      };
    }
  }

  const policy = await getPolicy(input.policyId);
  if (!policy) {
    throw new Error("Policy not found");
  }
  if (!policyOwnedBy(policy, payer)) {
    throw new Error("Policy not found or not owned by payer wallet");
  }

  const daily = await sumCompletedAmountToday();
  if (daily + totalAmount > env.MAX_DAILY_AMOUNT) {
    throw new Error(
      `Daily cap exceeded: ${daily} + ${totalAmount} > ${env.MAX_DAILY_AMOUNT}`,
    );
  }

  const recipients = policy.recipients as PolicyRecipient[];
  const legs = computeSplitAmounts(recipients, totalAmount).filter(
    (leg) => leg.amount > 0n,
  );

  if (input.transfers.length !== legs.length) {
    throw new Error(
      `Expected ${legs.length} transfer proofs, got ${input.transfers.length}`,
    );
  }

  const byRecipient = new Map<string, WalletTransferInput>();
  for (const transfer of input.transfers) {
    const key = getAddress(transfer.to).toLowerCase();
    if (byRecipient.has(key)) {
      throw new Error(`Duplicate transfer proof for ${transfer.to}`);
    }
    byRecipient.set(key, transfer);
  }

  const job = await createPayoutJob({
    policyId: policy.id,
    kind: "payroll",
    totalAmount: input.amount,
    clientJobId: input.clientJobId,
  });

  try {
    const proofs: JobTransfer[] = [];

    for (const leg of legs) {
      const proof = byRecipient.get(leg.address.toLowerCase());
      if (!proof) {
        throw new Error(`Missing transfer proof for ${leg.address}`);
      }
      if (BigInt(proof.amount) !== leg.amount) {
        throw new Error(
          `Amount mismatch for ${leg.address}: expected ${leg.amount}, got ${proof.amount}`,
        );
      }

      const txHash = proof.txHash as Hex;
      if (!env.DEV_MOCK_PAYOUT) {
        await verifyWalletUsdcTransfer({
          txHash,
          payer,
          to: leg.address,
          amount: leg.amount,
        });
      }

      proofs.push(toJobTransfer(leg.address, proof.amount, txHash, leg.label));
    }

    await completePayoutJob(job.id, proofs, {
      settlement: "wallet_sender",
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
      transfers: proofs,
      settlement: "wallet_sender",
      hireMode: input.hire.mode,
      payer,
      ...(input.hire.settlementTxHash
        ? { x402SettlementTxHash: input.hire.settlementTxHash }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallet payroll failed";
    await failPayoutJob(job.id, message);
    throw err;
  }
}

export async function recordWalletInstantJob(input: RecordWalletInstantInput) {
  const amount = BigInt(input.amount);
  assertAmountWithinCaps(amount);
  const payer = normalizeAddress(input.payer);
  const to = normalizeAddress(input.to);
  const txHash = input.txHash as Hex;

  const daily = await sumCompletedAmountToday();
  if (daily + amount > env.MAX_DAILY_AMOUNT) {
    throw new Error(
      `Daily cap exceeded: ${daily} + ${amount} > ${env.MAX_DAILY_AMOUNT}`,
    );
  }

  const job = await createPayoutJob({
    kind: "instant",
    totalAmount: input.amount,
  });

  try {
    if (!env.DEV_MOCK_PAYOUT) {
      await verifyWalletUsdcTransfer({
        txHash,
        payer,
        to,
        amount,
      });
    }

    const transfer = toJobTransfer(to, input.amount, txHash);
    await completePayoutJob(job.id, [transfer], {
      settlement: "wallet_sender",
      ...(input.hire.settlementTxHash
        ? { x402SettlementTxHash: input.hire.settlementTxHash }
        : {}),
      hireMode: input.hire.mode,
    });

    return {
      jobId: job.id,
      status: "completed",
      txHash,
      explorer: transfer.explorer,
      to,
      amount: input.amount,
      transfers: [transfer],
      settlement: "wallet_sender",
      hireMode: input.hire.mode,
      payer,
      ...(input.hire.settlementTxHash
        ? { x402SettlementTxHash: input.hire.settlementTxHash }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallet pay failed";
    await failPayoutJob(job.id, message);
    throw err;
  }
}
