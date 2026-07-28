/**
 * Pin Remifi registration metadata on ERC-8004 via setAgentURI.
 *
 * Usage (from celoremi/):
 *   npx tsx scripts/set-agent-uri.ts
 *
 * Uses data: URI (EIP-8004) so 8004scan can read metadata immediately
 * without waiting for GitHub/IPFS hosting.
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDENTITY_REGISTRY =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

const abi = [
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
] as const;

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // rely on process.env
  }
}

async function main() {
  loadEnv();
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("AGENT_PRIVATE_KEY missing");

  const agentId = BigInt(process.env.ERC8004_AGENT_ID || "9745");
  const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const rpc = process.env.CELO_RPC_URL || "https://forno.celo.org";

  const metaPath = resolve(process.cwd(), "public/agent.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<
    string,
    unknown
  >;
  meta.updatedAt = Math.floor(Date.now() / 1000);
  meta.registrations = [
    {
      agentId: Number(agentId),
      agentRegistry: `eip155:42220:${IDENTITY_REGISTRY}`,
    },
  ];

  const json = JSON.stringify(meta);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  const agentURI =
    process.env.ERC8004_AGENT_URI?.trim() ||
    `data:application/json;base64,${b64}`;

  console.log("Updating agentURI…");
  console.log("  agentId:", agentId.toString());
  console.log("  wallet:", account.address);
  console.log("  uri kind:", agentURI.startsWith("data:") ? "data:" : "https/ipfs");
  console.log("  payload bytes:", Buffer.byteLength(json, "utf8"));

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpc),
  });
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(rpc),
  });

  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: "setAgentURI",
    args: [agentId, agentURI],
  });
  console.log("  tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setAgentURI failed: ${hash}`);
  }

  const onchain = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: "tokenURI",
    args: [agentId],
  });

  console.log("\n✅ Metadata pinned");
  console.log("  8004scan: https://8004scan.io/agents/celo/" + agentId.toString());
  console.log("  tokenURI prefix:", String(onchain).slice(0, 48) + "…");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
