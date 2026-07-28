import { createPublicClient, getAddress, http, isAddress } from "viem";
import { normalize } from "viem/ens";
import { base, mainnet } from "viem/chains";
import { env } from "../config";

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/i.test(value.trim());
}

function isBasename(value: string): boolean {
  return value.trim().toLowerCase().endsWith(".base.eth");
}

function looksLikeEns(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (isHexAddress(v)) return false;
  return v.endsWith(".eth") || (v.includes(".") && !v.startsWith("0x"));
}

/** Prefer env RPC, then public fallbacks (llamarpc is often rate-limited / down). */
const ETH_RPC_FALLBACKS = [
  env.ETH_RPC_URL,
  "https://ethereum.publicnode.com",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
  "https://cloudflare-eth.com",
].filter((url, i, arr) => Boolean(url) && arr.indexOf(url) === i);

const BASE_RPC_FALLBACKS = [
  env.BASE_RPC_URL,
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://1rpc.io/base",
].filter((url, i, arr) => Boolean(url) && arr.indexOf(url) === i);

async function ensAddressFromRpcs(
  name: string,
  urls: string[],
  chain: typeof mainnet | typeof base,
): Promise<`0x${string}` | null> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const client = createPublicClient({
        chain,
        transport: http(url, { timeout: 12_000 }),
      });
      const address = await client.getEnsAddress({ name });
      if (address) return getAddress(address) as `0x${string}`;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[remifi] ENS lookup failed via ${url}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (lastErr) {
    console.warn("[remifi] All ENS RPCs failed for", name, lastErr);
  }
  return null;
}

async function ensNameFromAddress(
  address: `0x${string}`,
): Promise<string | undefined> {
  for (const [chain, urls] of [
    [base, BASE_RPC_FALLBACKS],
    [mainnet, ETH_RPC_FALLBACKS],
  ] as const) {
    for (const url of urls) {
      try {
        const client = createPublicClient({
          chain,
          transport: http(url, { timeout: 8_000 }),
        });
        const ens = await client.getEnsName({ address });
        if (ens) return ens;
      } catch {
        /* try next */
      }
    }
  }
  return undefined;
}

export type ResolvedAddress = {
  address: `0x${string}`;
  ens?: string;
  chain?: "ethereum" | "base";
};

/**
 * Resolve a 0x address, ENS name (*.eth on Ethereum), or Base name (*.base.eth).
 * Remifi on Celo: names resolve off Celo; settlement still pays USDC on Celo.
 */
export async function resolveAddressInput(raw: string): Promise<ResolvedAddress> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Recipient cannot be empty");
  }

  if (isHexAddress(trimmed) || isAddress(trimmed)) {
    const address = getAddress(trimmed) as `0x${string}`;
    const ens = await ensNameFromAddress(address);
    return ens ? { address, ens } : { address };
  }

  if (!looksLikeEns(trimmed)) {
    throw new Error(
      `Invalid recipient "${raw}". Use a 0x address, ENS name (vitalik.eth), or Base name (alice.base.eth).`,
    );
  }

  const name = normalize(trimmed);

  if (isBasename(trimmed)) {
    const address = await ensAddressFromRpcs(name, BASE_RPC_FALLBACKS, base);
    if (!address) {
      throw new Error(`Base name not found: ${trimmed}`);
    }
    return { address, ens: trimmed, chain: "base" };
  }

  const address = await ensAddressFromRpcs(name, ETH_RPC_FALLBACKS, mainnet);
  if (!address) {
    throw new Error(
      `ENS name not found: ${trimmed}. Check the name, or paste a 0x address.`,
    );
  }
  return {
    address,
    ens: trimmed,
    chain: "ethereum",
  };
}

export async function resolveRecipientAddresses<
  T extends { address: string; bps: number; label?: string },
>(
  recipients: T[],
): Promise<
  Array<{
    address: `0x${string}`;
    bps: number;
    label?: string;
    ens?: string;
  }>
> {
  const out = [];
  for (const r of recipients) {
    const resolved = await resolveAddressInput(r.address);
    out.push({
      address: resolved.address,
      bps: r.bps,
      ...(r.label ? { label: r.label } : {}),
      ...(resolved.ens ? { ens: resolved.ens } : {}),
    });
  }
  return out;
}
