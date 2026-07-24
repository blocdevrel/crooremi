import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { namehash, normalize } from "viem/ens";
import { env } from "../config.js";
import { resolveAddressInput } from "./ens.js";
import {
  BASE_L2_RESOLVER,
  BASE_REGISTRY,
  BASE_REGISTRAR_CONTROLLER,
  SECONDS_PER_YEAR,
} from "./ens-constants.js";
import type { EnsParentRegistration } from "./types.js";

const basenameControllerAbi = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "registerPrice",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "owner", type: "address" },
          { name: "duration", type: "uint256" },
          { name: "resolver", type: "address" },
          { name: "data", type: "bytes[]" },
          { name: "reverseRecord", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const resolverAbi = [
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

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

const registryOwnerAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

export async function getBasenameRegistryOwner(
  parentDomain: string,
): Promise<`0x${string}` | null> {
  const parent = normalize(parentDomain);
  const label = parseBasenameLabel(parent);
  if (!label) return null;

  const { publicClient } = getBaseClients();
  const owner = await publicClient.readContract({
    address: BASE_REGISTRY,
    abi: registryOwnerAbi,
    functionName: "owner",
    args: [namehash(parent)],
  });

  if (!owner || owner.toLowerCase() === zeroAddress) {
    return null;
  }
  return owner;
}

export function parseBasenameLabel(parentDomain: string): string | null {
  const name = normalize(parentDomain);
  if (!name.endsWith(".base.eth")) return null;
  const label = name.slice(0, -".base.eth".length);
  if (!label || label.includes(".")) return null;
  return label;
}

function getBaseClients() {
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

export async function isBasenameAvailable(label: string): Promise<boolean> {
  const { publicClient } = getBaseClients();
  return publicClient.readContract({
    address: BASE_REGISTRAR_CONTROLLER,
    abi: basenameControllerAbi,
    functionName: "available",
    args: [label],
  });
}

export async function registerBasenameParent(
  parentDomain: string,
  durationYears = env.ENS_REGISTRATION_YEARS,
): Promise<EnsParentRegistration> {
  const parent = normalize(parentDomain);
  const label = parseBasenameLabel(parent);
  if (!label) {
    throw new Error(
      `Expected a basename like remifi.base.eth, got ${parent}`,
    );
  }

  if (env.DEV_MOCK_ENS_SUBNAMES) {
    console.warn(`[remifi] DEV_MOCK_ENS_SUBNAMES — simulated basename ${parent}`);
    return {
      parent,
      label,
      registered: true,
      alreadyExisted: false,
      txHashes: [`0x${"11".repeat(32)}`],
      owner: "0x0000000000000000000000000000000000000001",
      durationYears,
      chain: "base",
      mock: true,
    };
  }

  try {
    const existing = await resolveAddressInput(parent);
    if (existing.address) {
      return {
        parent,
        label,
        registered: false,
        alreadyExisted: true,
        txHashes: [],
        owner: existing.address,
        durationYears,
        chain: "base",
      };
    }
  } catch {
    // not registered yet
  }

  const registryOwner = await getBasenameRegistryOwner(parent);
  if (registryOwner) {
    return {
      parent,
      label,
      registered: false,
      alreadyExisted: true,
      txHashes: [],
      owner: registryOwner,
      durationYears,
      chain: "base",
    };
  }

  const available = await isBasenameAvailable(label);
  if (!available) {
    throw new Error(`${parent} is not available on Base Names`);
  }

  const { publicClient, walletClient, account } = getBaseClients();
  const duration = BigInt(durationYears) * SECONDS_PER_YEAR;
  const price = await publicClient.readContract({
    address: BASE_REGISTRAR_CONTROLLER,
    abi: basenameControllerAbi,
    functionName: "registerPrice",
    args: [label, duration],
  });

  const fullName = parent;
  const resolverData = [
    encodeFunctionData({
      abi: resolverAbi,
      functionName: "setAddr",
      args: [namehash(fullName), account.address],
    }),
  ];

  const registerHash = await walletClient.writeContract({
    address: BASE_REGISTRAR_CONTROLLER,
    abi: basenameControllerAbi,
    functionName: "register",
    args: [
      {
        name: label,
        owner: account.address,
        duration,
        resolver: BASE_L2_RESOLVER,
        data: resolverData,
        reverseRecord: false,
      },
    ],
    value: price,
    account,
    chain: base,
  });
  await publicClient.waitForTransactionReceipt({ hash: registerHash });

  const verified = await resolveAddressInput(parent);
  return {
    parent,
    label,
    registered: true,
    alreadyExisted: false,
    txHashes: [registerHash],
    owner: verified.address,
    durationYears,
    chain: "base",
  };
}
