import type { Order } from "@croo-network/sdk";
import { env, baseExplorerTx } from "../config.js";
import type { InstantUsdcPayResolved } from "../policy/instant-usdc-pay.js";
import type { InstantUsdcPayDelivery } from "../policy/types.js";

function formatUsdcDisplay(baseUnits: string): string {
  const whole = BigInt(baseUnits);
  const dollars = Number(whole) / 1_000_000;
  return dollars.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function isDirectCapSettlement(order: Order, recipient: `0x${string}`): boolean {
  const fundTxHash = order.payTxHash?.trim();
  const providerFund = order.providerFundAddress?.trim().toLowerCase();
  return Boolean(
    fundTxHash &&
      providerFund &&
      providerFund === recipient.toLowerCase(),
  );
}

function assertDirectCapFundTransfer(
  order: Order,
  resolved: InstantUsdcPayResolved,
): void {
  const payTxHash = order.payTxHash?.trim();
  if (!payTxHash) {
    throw new Error(
      "Order missing payTxHash — CROO payOrder must complete before instant USDC delivery",
    );
  }

  const providerFund = order.providerFundAddress?.trim().toLowerCase();
  if (!providerFund) {
    throw new Error(
      "Instant USDC Pay requires CROO fund transfer to the recipient address. " +
        "Enable Require Fund Transfer on the Instant USDC Pay service in Agent Store.",
    );
  }

  if (providerFund !== resolved.address.toLowerCase()) {
    throw new Error(
      `Fund address mismatch: CAP sent to ${providerFund}, ` +
        `recipient is ${resolved.address}`,
    );
  }

  const expectedFund = BigInt(resolved.amount);
  if (!order.fundAmount || BigInt(order.fundAmount) !== expectedFund) {
    throw new Error(
      `Fund amount mismatch: payment needs ${expectedFund} base units, ` +
        `order fundAmount is ${order.fundAmount ?? "0"}. ` +
        "Buyer must pay principal + service fee via CAP fund transfer.",
    );
  }
}

export function buildDirectCapInstantPayDelivery(
  order: Order,
  resolved: InstantUsdcPayResolved,
): InstantUsdcPayDelivery {
  assertDirectCapFundTransfer(order, resolved);

  const fundTxHash = order.payTxHash!.trim();

  return {
    success: true,
    to: resolved.address,
    toInput: resolved.to,
    ens: resolved.ens,
    amount: resolved.amount,
    amountUsdc: formatUsdcDisplay(resolved.amount),
    reference: resolved.reference,
    fundTxHash,
    txHash: fundTxHash,
    baseExplorer: baseExplorerTx(fundTxHash),
    settlement: "direct_cap",
  };
}

function mockInstantPayDelivery(
  resolved: InstantUsdcPayResolved,
): InstantUsdcPayDelivery {
  const mockHash = `0x${"0".repeat(64)}` as `0x${string}`;
  return {
    success: true,
    to: resolved.address,
    toInput: resolved.to,
    ens: resolved.ens,
    amount: resolved.amount,
    amountUsdc: formatUsdcDisplay(resolved.amount),
    reference: resolved.reference,
    fundTxHash: mockHash,
    txHash: mockHash,
    baseExplorer: baseExplorerTx(mockHash),
    settlement: "mock_instant_pay",
  };
}

export async function settleInstantUsdcPay(
  order: Order,
  resolved: InstantUsdcPayResolved,
): Promise<InstantUsdcPayDelivery> {
  if (env.DEV_MOCK_PAYROLL_SETTLEMENT) {
    console.log("[remifi] instant USDC pay: mock mode — skipping CAP fund check");
    return mockInstantPayDelivery(resolved);
  }

  if (isDirectCapSettlement(order, resolved.address)) {
    return buildDirectCapInstantPayDelivery(order, resolved);
  }

  throw new Error(
    "Instant USDC Pay requires CROO fund transfer to the recipient. " +
      "Agent Store → Instant USDC Pay → Require Fund Transfer ON. " +
      "Split Execution uses the Router contract; instant pay uses CAP address sending only.",
  );
}

export function isNonFundServiceAcceptError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("provider_fund_address must be empty");
}
