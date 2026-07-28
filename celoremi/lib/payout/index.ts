import {
  concat,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseAbi,
} from "viem";
import { attributionDataSuffix } from "../attribution";
import {
  createCeloPublicClient,
  createCeloWalletClient,
  requireAgentAccount,
  getAgentAddress,
} from "../chain/clients";
import { CELOSCAN_TX, env } from "../config";
import type { PolicyRecipient, TransferProof } from "../policy/validate";
import { computeSplitAmounts } from "../policy/validate";

const balanceAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

export type TaggedTransferResult = {
  to: `0x${string}`;
  amount: bigint;
  txHash: Hex;
  explorer: string;
};

async function assertAgentFunded(required: bigint): Promise<void> {
  const agent = getAgentAddress();
  if (!agent) {
    throw new Error("Agent wallet not configured");
  }

  const publicClient = createCeloPublicClient();
  const balance = await publicClient.readContract({
    address: env.USDC_ADDRESS as `0x${string}`,
    abi: balanceAbi,
    functionName: "balanceOf",
    args: [agent],
  });

  if (balance < required) {
    throw new Error(
      `Agent USDC balance ${balance} < required ${required} (wallet ${agent})`,
    );
  }
}

export async function sendTaggedUsdcTransfer(
  to: `0x${string}`,
  amount: bigint,
): Promise<TaggedTransferResult> {
  if (amount <= 0n) {
    throw new Error("Transfer amount must be > 0");
  }

  if (env.DEV_MOCK_PAYOUT) {
    const mockHash = `0x${"a".repeat(64)}` as Hex;
    console.log("[remifi] mock tagged transfer", { to, amount: amount.toString() });
    return {
      to,
      amount,
      txHash: mockHash,
      explorer: CELOSCAN_TX(mockHash),
    };
  }

  await assertAgentFunded(amount);

  const account = requireAgentAccount();
  const publicClient = createCeloPublicClient();
  const walletClient = createCeloWalletClient(account);
  const usdc = env.USDC_ADDRESS as `0x${string}`;
  const tag = attributionDataSuffix();

  const data = concat([
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    }),
    tag,
  ]);

  const hash = await walletClient.sendTransaction({
    account,
    to: usdc,
    data,
    chain: publicClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Tagged USDC transfer reverted: ${hash}`);
  }

  return {
    to,
    amount,
    txHash: hash,
    explorer: CELOSCAN_TX(hash),
  };
}

export async function executePayrollTransfers(
  recipients: PolicyRecipient[],
  totalAmount: bigint,
): Promise<TransferProof[]> {
  const legs = computeSplitAmounts(recipients, totalAmount);
  await assertAgentFunded(totalAmount);

  const proofs: TransferProof[] = [];

  for (const leg of legs) {
    if (leg.amount === 0n) continue;

    const result = await sendTaggedUsdcTransfer(leg.address, leg.amount);
    proofs.push({
      to: result.to,
      amount: result.amount.toString(),
      txHash: result.txHash,
      explorer: result.explorer,
      ...(leg.label ? { label: leg.label } : {}),
    });
  }

  return proofs;
}

export function assertAmountWithinCaps(amount: bigint): void {
  if (amount < env.MIN_AMOUNT) {
    throw new Error(
      `Amount ${amount} below minimum ${env.MIN_AMOUNT} (USDC base units)`,
    );
  }
  if (amount > env.MAX_AMOUNT_PER_JOB) {
    throw new Error(
      `Amount ${amount} exceeds MAX_AMOUNT_PER_JOB ${env.MAX_AMOUNT_PER_JOB}`,
    );
  }
}
