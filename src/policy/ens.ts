import { createPublicClient, http, isAddress } from "viem";
import { normalize } from "viem/ens";
import { base } from "viem/chains";
import { env } from "../config.js";
import { getBasenameRegistryOwner } from "./ens-register-base.js";

const baseEnsClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL),
});

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeHexAddress(value: string): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}

function isBasename(value: string): boolean {
  return value.toLowerCase().endsWith(".base.eth");
}

export async function reverseResolveAddress(
  address: `0x${string}`,
): Promise<string | undefined> {
  const normalized = normalizeHexAddress(address);
  const baseName = await baseEnsClient
    .getEnsName({ address: normalized })
    .catch(() => null);
  return baseName ?? undefined;
}

export async function resolveAddressInput(
  raw: string,
): Promise<{ address: `0x${string}`; ens?: string }> {
  const trimmed = raw.trim();

  if (isHexAddress(trimmed)) {
    const address = normalizeHexAddress(trimmed);
    const ens = await reverseResolveAddress(address);
    return ens ? { address, ens } : { address };
  }

  if (isAddress(trimmed)) {
    const address = trimmed as `0x${string}`;
    const ens = await reverseResolveAddress(address);
    return ens ? { address, ens } : { address };
  }

  if (!isBasename(trimmed)) {
    throw new Error(
      `Invalid recipient "${raw}". Use a 0x address or Base name (*.base.eth).`,
    );
  }

  const name = normalize(trimmed);
  const address = await baseEnsClient.getEnsAddress({ name }).catch(() => null);

  if (address) {
    return { address, ens: trimmed };
  }

  // Registered basename without resolver addr yet — use registry owner for routing
  const registryOwner = await getBasenameRegistryOwner(name);
  if (registryOwner) {
    return { address: registryOwner, ens: trimmed };
  }

  throw new Error(`Base name not found: ${trimmed}`);
}

export async function resolveRecipients<
  T extends { address: string; label: string; bps: number; ens?: string },
>(recipients: T[]): Promise<
  Array<{
    address: `0x${string}`;
    label: string;
    bps: number;
    ens?: string;
  }>
> {
  const resolved = [];
  for (const recipient of recipients) {
    const { address, ens } = await resolveAddressInput(recipient.address);
    resolved.push({
      address,
      label: recipient.label,
      bps: recipient.bps,
      ens: recipient.ens ?? ens,
    });
  }
  return resolved;
}
