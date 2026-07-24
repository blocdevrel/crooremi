import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { labelhash, namehash, normalize } from "viem/ens";
import { ensureOrgParent, canProvisionEns, isOrgRegistrationEnabled } from "./ens-org.js";
import { env } from "../config.js";
import { resolveAddressInput } from "./ens.js";
import { getBasenameRegistryOwner } from "./ens-register-base.js";
import {
  BASE_L2_RESOLVER,
  BASE_REGISTRY,
} from "./ens-constants.js";
import type { EnsParentRegistration } from "./types.js";

const ensRegistryAbi = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

const publicResolverAbi = [
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "a", type: "address" },
    ],
    outputs: [],
  },
] as const;

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type EnsSubnameResult = {
  ens: string;
  address: `0x${string}`;
  created: boolean;
  txHashes: string[];
};

export type RecipientWithSubname = {
  address: `0x${string}`;
  label: string;
  bps: number;
  ens?: string;
  subname?: string;
};

function normalizeLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (!LABEL_RE.test(normalized)) {
    throw new Error(
      `Invalid ENS subname label "${label}". Use lowercase letters, numbers, and hyphens.`,
    );
  }
  return normalized;
}

function fullSubname(label: string, parentDomain: string): string {
  const parent = normalize(parentDomain);
  return normalize(`${label}.${parent}`);
}

function assertBasenameParent(parentDomain: string): void {
  if (!parentDomain.toLowerCase().endsWith(".base.eth")) {
    throw new Error(
      `Parent must be a Base name (*.base.eth), got ${parentDomain}`,
    );
  }
}

function getBaseWriteClients() {
  const key = env.ENS_REGISTRAR_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "ENS_REGISTRAR_PRIVATE_KEY is required — Remifi operator wallet (small ETH float on Base)",
    );
  }

  const normalizedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(normalizedKey as Hex);
  const transport = http(env.BASE_RPC_URL);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });

  return { publicClient, walletClient, account };
}

async function forwardResolve(name: string): Promise<`0x${string}` | null> {
  try {
    const { address } = await resolveAddressInput(name);
    return address;
  } catch {
    return null;
  }
}

function mockSubname(ens: string, address: `0x${string}`): EnsSubnameResult {
  return {
    ens,
    address,
    created: true,
    txHashes: [`0x${"00".repeat(32)}`],
  };
}

async function createBaseSubname(
  subnameLabel: string,
  parentDomain: string,
  address: `0x${string}`,
  ens: string,
): Promise<string[]> {
  const { publicClient, walletClient, account } = getBaseWriteClients();
  const parent = normalize(parentDomain);
  const parentOwner = await getBasenameRegistryOwner(parent);
  if (!parentOwner || parentOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Operator wallet ${account.address} does not own ${parent} (registry owner: ${parentOwner ?? "none"}). ` +
        "Set ENS_REGISTRAR_PRIVATE_KEY to the basename owner wallet, or transfer the name to the operator.",
    );
  }

  const parentNode = namehash(parent);
  const node = namehash(ens);
  const txHashes: string[] = [];

  const createHash = await walletClient.writeContract({
    address: BASE_REGISTRY,
    abi: ensRegistryAbi,
    functionName: "setSubnodeRecord",
    args: [parentNode, labelhash(subnameLabel), account.address, BASE_L2_RESOLVER, 0n],
    account,
    chain: base,
  });
  await publicClient.waitForTransactionReceipt({ hash: createHash });
  txHashes.push(createHash);

  const addrHash = await walletClient.writeContract({
    address: BASE_L2_RESOLVER,
    abi: publicResolverAbi,
    functionName: "setAddr",
    args: [node, address],
    account,
    chain: base,
  });
  await publicClient.waitForTransactionReceipt({ hash: addrHash });
  txHashes.push(addrHash);

  return txHashes;
}

export async function ensureSubname(
  label: string,
  parentDomain: string,
  address: `0x${string}`,
): Promise<EnsSubnameResult> {
  assertBasenameParent(parentDomain);
  const subnameLabel = normalizeLabel(label);
  const ens = fullSubname(subnameLabel, parentDomain);

  if (env.DEV_MOCK_ENS_SUBNAMES) {
    console.warn(`[remifi] DEV_MOCK_ENS_SUBNAMES — simulated subname ${ens}`);
    return mockSubname(ens, address);
  }

  const existing = await forwardResolve(ens);
  if (existing) {
    if (existing.toLowerCase() === address.toLowerCase()) {
      return { ens, address, created: false, txHashes: [] };
    }
    throw new Error(
      `ENS name ${ens} already resolves to ${existing}, cannot point to ${address}`,
    );
  }

  const txHashes = await createBaseSubname(subnameLabel, parentDomain, address, ens);

  const verified = await forwardResolve(ens);
  if (!verified || verified.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`ENS subname ${ens} was created but forward resolve failed`);
  }

  return { ens, address, created: true, txHashes };
}

export async function provisionPolicySubnames(
  recipients: RecipientWithSubname[],
  parentDomain: string,
): Promise<{
  recipients: RecipientWithSubname[];
  ensSubnames: EnsSubnameResult[];
  ensParentRegistration?: EnsParentRegistration | null;
}> {
  if (!parentDomain) {
    return { recipients, ensSubnames: [] };
  }

  assertBasenameParent(parentDomain);

  if (!canProvisionEns()) {
    console.warn(
      "[remifi] ENS org configured but ENS_REGISTRAR_PRIVATE_KEY missing — skipping subnames",
    );
    return { recipients, ensSubnames: [] };
  }

  const ensParentRegistration = isOrgRegistrationEnabled()
    ? await ensureOrgParent(parentDomain)
    : undefined;

  const ensSubnames: EnsSubnameResult[] = [];
  const updated: RecipientWithSubname[] = [];

  for (const recipient of recipients) {
    if (!recipient.subname) {
      updated.push(recipient);
      continue;
    }

    const result = await ensureSubname(
      recipient.subname,
      parentDomain,
      recipient.address,
    );
    ensSubnames.push(result);
    updated.push({
      ...recipient,
      ens: result.ens,
      subname: recipient.subname,
    });
  }

  return { recipients: updated, ensSubnames, ensParentRegistration };
}
