import { keccak256, parseAbi, parseAbiItem, stringToBytes } from "viem";
import type { Order } from "@croo-network/sdk";
import { env } from "../config.js";
import { saveRouterSplitResult } from "../cap/order-ledger.js";
import type { ExecuteBatchPlan } from "../policy/types.js";
import { routerAbi } from "./abi/router-abi.js";
import {
  createBasePublicClient,
  createBaseWalletClient,
} from "./chain-clients.js";
import { getPayoutWalletAddress, requirePayoutAccount } from "./payout-wallet.js";
import type { DisbursedRecipient } from "./payroll-disbursement.js";

export { routerAbi };

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

export function capOrderToSplitKey(orderId: string): `0x${string}` {
  return keccak256(stringToBytes(orderId));
}

export class RouterSplitAlreadyExecutedError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Split already executed for order ${orderId}`);
    this.name = "RouterSplitAlreadyExecutedError";
    this.orderId = orderId;
  }
}

export function getRouterAddress(): `0x${string}` | undefined {
  const raw = env.ROUTER_ADDRESS?.trim();
  if (!raw) {
    return undefined;
  }
  return raw.toLowerCase() as `0x${string}`;
}

export function isRouterConfigured(): boolean {
  return Boolean(getRouterAddress());
}

export async function validateRouterDeployment(): Promise<void> {
  const router = getRouterAddress();
  if (!router) {
    return;
  }

  if (env.DEV_MOCK_PAYROLL_SETTLEMENT) {
    console.log("[remifi] router validation skipped — DEV_MOCK_PAYROLL_SETTLEMENT");
    return;
  }

  const payoutAddress = getPayoutWalletAddress();
  if (!payoutAddress) {
    throw new Error(
      "ROUTER_ADDRESS is set but no payout private key — set PROVIDER_PAYOUT_PRIVATE_KEY or ENS_REGISTRAR_PRIVATE_KEY",
    );
  }

  const publicClient = createBasePublicClient();
  const [onChainToken, onChainExecutor] = await Promise.all([
    publicClient.readContract({
      address: router,
      abi: routerAbi,
      functionName: "token",
    }) as Promise<`0x${string}`>,
    publicClient.readContract({
      address: router,
      abi: routerAbi,
      functionName: "executor",
    }) as Promise<`0x${string}`>,
  ]);

  const expectedUsdc = env.USDC_ADDRESS.toLowerCase();
  if (onChainToken.toLowerCase() !== expectedUsdc) {
    throw new Error(
      `Router token ${onChainToken} does not match USDC_ADDRESS ${expectedUsdc}`,
    );
  }

  if (onChainExecutor.toLowerCase() !== payoutAddress.toLowerCase()) {
    throw new Error(
      `Router executor ${onChainExecutor} does not match payout wallet ${payoutAddress}. ` +
        "Deploy with ROUTER_EXECUTOR_ADDRESS = address(PROVIDER_PAYOUT_PRIVATE_KEY).",
    );
  }

  const configuredExecutor = env.ROUTER_EXECUTOR_ADDRESS?.trim().toLowerCase();
  if (
    configuredExecutor &&
    configuredExecutor !== onChainExecutor.toLowerCase()
  ) {
    throw new Error(
      `ROUTER_EXECUTOR_ADDRESS ${configuredExecutor} does not match on-chain executor ${onChainExecutor}`,
    );
  }

  console.log("[remifi] router validated", {
    router,
    token: onChainToken,
    executor: onChainExecutor,
  });
}

async function assertRouterFunded(
  order: Order,
  router: `0x${string}`,
  requiredAmount: bigint,
): Promise<void> {
  const providerFund = order.providerFundAddress?.trim().toLowerCase();
  if (providerFund && providerFund !== router.toLowerCase()) {
    throw new Error(
      `Order fund address ${providerFund} does not match ROUTER_ADDRESS ${router}. ` +
        "Re-accept execute orders with the router as providerFundAddress.",
    );
  }

  const publicClient = createBasePublicClient();
  const balance = await publicClient.readContract({
    address: env.USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [router],
  });

  if (balance < requiredAmount) {
    throw new Error(
      `Router USDC balance ${balance} is below required ${requiredAmount} base units`,
    );
  }
}

export async function disburseViaRouter(
  order: Order,
  plan: ExecuteBatchPlan,
): Promise<DisbursedRecipient[]> {
  const router = getRouterAddress();
  if (!router) {
    throw new Error("ROUTER_ADDRESS is not configured");
  }

  const requiredAmount = plan.legs.reduce(
    (sum, leg) => sum + BigInt(leg.recipient.amount),
    0n,
  );

  if (plan.fundAmount && BigInt(plan.fundAmount) !== requiredAmount) {
    throw new Error(
      `Plan fundAmount ${plan.fundAmount} does not match leg total ${requiredAmount}`,
    );
  }

  await assertRouterFunded(order, router, requiredAmount);

  const orderKey = capOrderToSplitKey(order.orderId);
  const recipients = plan.legs.map((leg) => leg.recipient.address);
  const amounts = plan.legs.map((leg) => BigInt(leg.recipient.amount));

  const account = requirePayoutAccount();
  const publicClient = createBasePublicClient();
  const walletClient = createBaseWalletClient(account);

  const alreadyExecuted = await publicClient.readContract({
    address: router,
    abi: routerAbi,
    functionName: "executed",
    args: [orderKey],
  });
  if (alreadyExecuted) {
    throw new RouterSplitAlreadyExecutedError(order.orderId);
  }

  const hash = await walletClient.writeContract({
    address: router,
    abi: routerAbi,
    functionName: "executeSplit",
    args: [orderKey, recipients, amounts, requiredAmount],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Router executeSplit reverted: ${hash}`);
  }

  console.log("[remifi] router split executed", {
    orderId: order.orderId,
    orderKey,
    router,
    txHash: hash,
    recipients: recipients.length,
    totalAmount: requiredAmount.toString(),
  });

  const disbursed = plan.legs.map((leg) => ({
    label: leg.recipient.label,
    address: leg.recipient.address,
    amount: leg.recipient.amount,
    txHash: hash,
  }));

  await saveRouterSplitResult(order.orderId, order.serviceId, hash, disbursed);

  return disbursed;
}

export async function recoverRouterSplitFromChain(
  order: Order,
  plan: ExecuteBatchPlan,
): Promise<{ recipients: DisbursedRecipient[]; splitTxHash: `0x${string}` } | null> {
  const router = getRouterAddress();
  if (!router) {
    return null;
  }

  const orderKey = capOrderToSplitKey(order.orderId);
  const publicClient = createBasePublicClient();

  const executed = await publicClient.readContract({
    address: router,
    abi: routerAbi,
    functionName: "executed",
    args: [orderKey],
  });
  if (!executed) {
    return null;
  }

  const logs = await publicClient.getLogs({
    address: router,
    event: parseAbiItem(
      "event SplitExecuted(bytes32 indexed orderKey, uint256 totalAmount, uint256 recipientCount)",
    ),
    args: { orderKey },
    fromBlock: 0n,
    toBlock: "latest",
  });

  const splitTxHash = (logs.at(-1)?.transactionHash ??
    order.payTxHash) as `0x${string}` | undefined;
  if (!splitTxHash) {
    return null;
  }

  const recipients = plan.legs.map((leg) => ({
    label: leg.recipient.label,
    address: leg.recipient.address,
    amount: leg.recipient.amount,
    txHash: splitTxHash,
  }));

  await saveRouterSplitResult(order.orderId, order.serviceId, splitTxHash, recipients);

  return { recipients, splitTxHash };
}
