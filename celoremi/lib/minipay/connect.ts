import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type WalletClient,
} from "viem";
import { celo } from "viem/chains";

const CELO_RPC =
  process.env.NEXT_PUBLIC_CELO_RPC_URL?.trim() || "https://forno.celo.org";

/** Celo mainnet USDC (Circle). */
export const CELO_USDC =
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const satisfies Address;

export const CELO_CHAIN_ID = 42220;
const CELO_CHAIN_HEX = "0xa4ec";

const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function isMiniPayRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum?.isMiniPay);
}

/** Phone / tablet browsers — use MiniPay deeplink instead of browser wallet connect. */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  return window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
}

export function getRemifiAppUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://remifi.up.railway.app";
}

/** Open this Mini App inside the MiniPay wallet (mobile / desktop). */
export function getMiniPayDeepLink(appUrl = getRemifiAppUrl()): string {
  return `https://link.minipay.xyz/browse?url=${encodeURIComponent(appUrl)}`;
}

export function openInMiniPay(appUrl?: string): void {
  if (typeof window === "undefined") return;
  window.location.href = getMiniPayDeepLink(appUrl);
}

export async function getWalletChainId(): Promise<number | null> {
  if (!hasInjectedProvider()) return null;
  try {
    const hex = (await getEthereumProvider().request({
      method: "eth_chainId",
    })) as string;
    return Number.parseInt(hex, 16);
  } catch {
    return null;
  }
}

/** Switch injected wallet to Celo mainnet before signing. */
export async function ensureCeloChain(): Promise<void> {
  const provider = getEthereumProvider();
  const current = await getWalletChainId();
  if (current === CELO_CHAIN_ID) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CELO_CHAIN_HEX }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/4902|Unrecognized chain/i.test(msg)) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CELO_CHAIN_HEX,
          chainName: "Celo",
          nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
          rpcUrls: ["https://forno.celo.org"],
          blockExplorerUrls: ["https://celoscan.io"],
        },
      ],
    });
  }
}

export function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error(
      "No wallet found. Open Remifi inside MiniPay, or use a Celo-compatible browser wallet.",
    );
  }
  return window.ethereum;
}

export function createMiniPayWalletClient(): WalletClient {
  return createWalletClient({
    chain: celo,
    transport: custom(getEthereumProvider()),
  });
}

/** Build a viem client for an already-known injected account. */
export function buildInjectedWalletClient(account: Address): WalletClient {
  const provider = getEthereumProvider();
  return createWalletClient({
    account,
    chain: celo,
    transport: custom(provider),
  });
}

/** Auto-connect: request accounts via injected MiniPay / browser wallet. */
export async function connectMiniPay(): Promise<{
  address: Address;
  isMiniPay: boolean;
  client: WalletClient;
}> {
  const provider = getEthereumProvider();
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts[0] as Address | undefined;
  if (!address) throw new Error("Wallet returned no accounts");

  return {
    address,
    isMiniPay: Boolean(provider.isMiniPay),
    client: buildInjectedWalletClient(address),
  };
}

/** Silent read of already-connected accounts (MiniPay often injects one). */
export async function tryGetAccounts(): Promise<Address | null> {
  if (!hasInjectedProvider()) return null;
  try {
    const accounts = (await getEthereumProvider().request({
      method: "eth_accounts",
    })) as string[];
    return (accounts[0] as Address | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Inside MiniPay: connect silently via eth_accounts, then eth_requestAccounts if needed.
 * No-op outside MiniPay runtime.
 */
export async function autoConnectMiniPay(): Promise<{
  address: Address;
  isMiniPay: boolean;
  client: WalletClient;
} | null> {
  if (!isMiniPayRuntime()) return null;

  const provider = getEthereumProvider();
  let address = await tryGetAccounts();

  if (!address) {
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    address = (accounts[0] as Address | undefined) ?? null;
  }

  if (!address) return null;

  return {
    address,
    isMiniPay: true,
    client: buildInjectedWalletClient(address),
  };
}

/** Fund the Remifi agent wallet with USDC from the connected MiniPay / wallet. */
export async function fundAgentWithUsdc(params: {
  client: WalletClient;
  account: Address;
  agentAddress: Address;
  amountBaseUnits: bigint;
}): Promise<`0x${string}`> {
  if (params.account.toLowerCase() === params.agentAddress.toLowerCase()) {
    throw new Error(
      "Use your personal wallet — not the Remifi agent address",
    );
  }

  await ensureCeloChain();

  const hash = await params.client.writeContract({
    account: params.account,
    chain: celo,
    address: CELO_USDC,
    abi: erc20TransferAbi,
    functionName: "transfer",
    args: [params.agentAddress, params.amountBaseUnits],
  });

  const receipt = await createPublicClient({
    chain: celo,
    transport: http(CELO_RPC),
  }).waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error("USDC transfer to agent failed on-chain");
  }

  return hash;
}
