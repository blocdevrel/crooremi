import type { Order } from "@croo-network/sdk";
import { parseAbi } from "viem";
import { env } from "../config.js";
import {
  loadOrderFulfillment,
  appendWalletDisbursementLeg,
  walletRecipientsFromLedger,
  routerSplitTxFromLedger,
  getStagedDelivery,
} from "../cap/order-ledger.js";
import type { ExecuteBatchPlan, ExecutePayoutLeg } from "../policy/types.js";
import {
  createBasePublicClient,
  createBaseWalletClient,
} from "./chain-clients.js";
import { disburseViaRouter, isRouterConfigured, recoverRouterSplitFromChain, RouterSplitAlreadyExecutedError } from "./router.js";
import { getPayoutWalletAddress, requirePayoutAccount } from "./payout-wallet.js";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type DisbursedRecipient = {
  label: string;
  address: `0x${string}`;
  amount: string;
  txHash: string;
};

export type DisbursementMode = "router_payroll" | "wallet_payroll" | "mock_payroll";

export type DisbursementResult = {
  recipients: DisbursedRecipient[];
  settlement: DisbursementMode;
  splitTxHash?: string;
};

function mockDisbursement(legs: ExecutePayoutLeg[]): DisbursementResult {
  const recipients = legs.map((leg, index) => ({
    label: leg.recipient.label,
    address: leg.recipient.address,
    amount: leg.recipient.amount,
    txHash: `0x${"0".repeat(63)}${(index + 1).toString(16)}` as `0x${string}`,
  }));
  return { recipients, settlement: "mock_payroll", splitTxHash: recipients[0]?.txHash };
}

async function assertPayoutWalletFunded(
  order: Order,
  requiredAmount: bigint,
): Promise<void> {
  const payoutAddress = getPayoutWalletAddress();
  if (!payoutAddress) {
    throw new Error("Payout wallet address could not be derived");
  }

  const providerFund = order.providerFundAddress?.trim().toLowerCase();
  if (providerFund && providerFund !== payoutAddress.toLowerCase()) {
    throw new Error(
      `Order fund address ${providerFund} does not match payout wallet ${payoutAddress}. ` +
        "Re-accept execute orders with the payout EOA or ROUTER_ADDRESS.",
    );
  }

  const publicClient = createBasePublicClient();
  const balance = await publicClient.readContract({
    address: env.USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payoutAddress],
  });

  if (balance < requiredAmount) {
    throw new Error(
      `Payout wallet USDC balance ${balance} is below required ${requiredAmount} base units`,
    );
  }
}

async function disburseFromPayoutWallet(
  order: Order,
  plan: ExecuteBatchPlan,
): Promise<DisbursementResult> {
  const account = requirePayoutAccount();
  const requiredAmount = plan.legs.reduce(
    (sum, leg) => sum + BigInt(leg.recipient.amount),
    0n,
  );

  await assertPayoutWalletFunded(order, requiredAmount);

  const ledger = await loadOrderFulfillment(order.orderId);
  const completed = walletRecipientsFromLedger(ledger?.deliveryPayload ?? {});
  const completedAddresses = new Set(
    completed.map((row) => row.address.toLowerCase()),
  );

  const publicClient = createBasePublicClient();
  const walletClient = createBaseWalletClient(account);
  const usdc = env.USDC_ADDRESS as `0x${string}`;

  const results: DisbursedRecipient[] = [...completed.map((row) => ({
    label: row.label,
    address: row.address as `0x${string}`,
    amount: row.amount,
    txHash: row.txHash,
  }))];

  for (const leg of plan.legs) {
    if (completedAddresses.has(leg.recipient.address.toLowerCase())) {
      console.log("[remifi] payroll transfer skipped (ledger)", {
        label: leg.recipient.label,
        address: leg.recipient.address,
      });
      continue;
    }

    const amount = BigInt(leg.recipient.amount);
    const hash = await walletClient.writeContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [leg.recipient.address, amount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(
        `USDC transfer to ${leg.recipient.label} (${leg.recipient.address}) reverted: ${hash}`,
      );
    }

    const row: DisbursedRecipient = {
      label: leg.recipient.label,
      address: leg.recipient.address,
      amount: leg.recipient.amount,
      txHash: hash,
    };

    console.log("[remifi] payroll transfer", {
      label: row.label,
      address: row.address,
      amount: row.amount,
      txHash: row.txHash,
    });

    await appendWalletDisbursementLeg(order.orderId, order.serviceId, row);
    results.push(row);
  }

  return { recipients: results, settlement: "wallet_payroll" };
}

export async function disbursePayrollLegs(
  order: Order,
  plan: ExecuteBatchPlan,
): Promise<DisbursementResult> {
  if (plan.legs.length === 0) {
    throw new Error("Payroll execution requires at least one recipient");
  }

  if (env.DEV_MOCK_PAYROLL_SETTLEMENT) {
    console.log("[remifi] payroll disbursement: mock mode — skipping on-chain transfers");
    return mockDisbursement(plan.legs);
  }

  if (isRouterConfigured()) {
    try {
      const recipients = await disburseViaRouter(order, plan);
      return {
        recipients,
        settlement: "router_payroll",
        splitTxHash: recipients[0]?.txHash,
      };
    } catch (err) {
      if (err instanceof RouterSplitAlreadyExecutedError) {
        const ledger = await loadOrderFulfillment(err.orderId);
        const payload = ledger?.deliveryPayload ?? {};

        if (Array.isArray(payload.recipients) && payload.recipients.length > 0) {
          const saved = payload.recipients as DisbursedRecipient[];
          return {
            recipients: saved,
            settlement: "router_payroll",
            splitTxHash: payload.splitTxHash as `0x${string}` | undefined,
          };
        }

        const staged = getStagedDelivery(payload);
        if (staged?.recipients) {
          const saved = staged.recipients as DisbursedRecipient[];
          return {
            recipients: saved,
            settlement: "router_payroll",
            splitTxHash: staged.splitTxHash as `0x${string}` | undefined,
          };
        }

        const routerRecipients = walletRecipientsFromLedger(payload);
        const routerTx = routerSplitTxFromLedger(payload);
        if (routerRecipients.length > 0 && routerTx) {
          return {
            recipients: routerRecipients as DisbursedRecipient[],
            settlement: "router_payroll",
            splitTxHash: routerTx as `0x${string}`,
          };
        }

        const recovered = await recoverRouterSplitFromChain(order, plan);
        if (recovered) {
          return {
            recipients: recovered.recipients,
            settlement: "router_payroll",
            splitTxHash: recovered.splitTxHash,
          };
        }
      }
      throw err;
    }
  }

  return disburseFromPayoutWallet(order, plan);
}
