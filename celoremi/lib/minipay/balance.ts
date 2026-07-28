import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import type { Address } from "viem";
import { celo } from "viem/chains";
import { CELO_USDC } from "./connect";

const RPC =
  process.env.NEXT_PUBLIC_CELO_RPC_URL?.trim() || "https://forno.celo.org";

export function createCeloBrowserPublicClient() {
  return createPublicClient({
    chain: celo,
    transport: http(RPC),
  });
}

export async function readUsdcBalanceBaseUnits(
  address: Address,
): Promise<bigint> {
  const client = createCeloBrowserPublicClient();
  return client.readContract({
    address: CELO_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function readWalletUsdcBalance(
  address: Address,
): Promise<string> {
  const raw = await readUsdcBalanceBaseUnits(address);
  return formatUnits(raw, 6);
}

/** Format a USDC decimal string for the amount input (up to 6 dp, trim trailing zeros). */
export function usdcDecimalForInput(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";
  const fixed = n.toFixed(6).replace(/\.?0+$/, "");
  return fixed.includes(".") ? fixed : `${fixed}.00`;
}
