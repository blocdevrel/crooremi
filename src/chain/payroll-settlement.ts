import type { Order } from "@croo-network/sdk";
import { baseExplorerTx } from "../config.js";
import type { ExecuteBatchPlan, ExecutePaymentDelivery } from "../policy/types.js";
import { disbursePayrollLegs } from "./payroll-disbursement.js";

function assertPayrollFundTransfer(order: Order, plan: ExecuteBatchPlan): void {
  const payTxHash = order.payTxHash?.trim();
  if (!payTxHash) {
    throw new Error(
      "Order missing payTxHash — CROO payOrder must complete before payroll delivery",
    );
  }

  if (!order.providerFundAddress?.trim()) {
    throw new Error(
      "Order missing providerFundAddress — fund-transfer accept must declare payout wallet",
    );
  }

  const expectedFund = BigInt(plan.fundAmount);
  if (order.fundAmount && BigInt(order.fundAmount) !== expectedFund) {
    throw new Error(
      `Fund amount mismatch: payroll needs ${expectedFund} base units, ` +
        `order fundAmount is ${order.fundAmount}`,
    );
  }
}

export async function executePayrollSettlement(
  order: Order,
  plan: ExecuteBatchPlan,
  deliverTxHash?: string,
): Promise<ExecutePaymentDelivery> {
  if (plan.legs.length === 0) {
    throw new Error("Payroll execution requires at least one recipient");
  }

  assertPayrollFundTransfer(order, plan);

  const fundTxHash = order.payTxHash!.trim();
  const disbursement = await disbursePayrollLegs(order, plan);
  const recipients = disbursement.recipients;
  const recipientTxHashes = [...new Set(recipients.map((row) => row.txHash))];
  const capDeliverTxHash = deliverTxHash?.trim() || order.deliverTxHash?.trim();

  const txHashes = [
    fundTxHash,
    ...recipientTxHashes,
    ...(capDeliverTxHash ? [capDeliverTxHash] : []),
  ];

  const primaryProofTx =
    disbursement.splitTxHash ?? recipientTxHashes[0] ?? fundTxHash;

  return {
    policyId: plan.policyId,
    totalUsdc: plan.totalUsdc,
    fundTxHash,
    deliverTxHash: capDeliverTxHash,
    splitTxHash: disbursement.splitTxHash,
    txHashes,
    recipients,
    baseExplorer: baseExplorerTx(primaryProofTx),
    settlement: disbursement.settlement,
  };
}
