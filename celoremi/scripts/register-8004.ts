/**
 * Register Remifi on Celo mainnet ERC-8004 Identity Registry.
 *
 * Usage (from celoremi/):
 *   npx tsx scripts/register-8004.ts
 *
 * Requires AGENT_PRIVATE_KEY + CELO gas in .env.
 * After success, set this on Builders submission:
 *   https://8004scan.io/agents/celo/<agentId>
 *
 * Optional: ERC8004_AGENT_URI=https://…/agent.json
 * If unset, registers with an empty URI (you can setAgentURI later).
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDENTITY_REGISTRY =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

const registerAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
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
  if (!pk) throw new Error("AGENT_PRIVATE_KEY missing in .env");

  const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const rpc = process.env.CELO_RPC_URL || "https://forno.celo.org";
  const agentURI = process.env.ERC8004_AGENT_URI?.trim() || "";

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpc),
  });
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(rpc),
  });

  console.log("Registering Remifi on ERC-8004…");
  console.log("  wallet:", account.address);
  console.log("  agentURI:", agentURI || "(none — mint identity only)");
  console.log("  registry:", IDENTITY_REGISTRY);

  const hash = agentURI
    ? await walletClient.writeContract({
        address: IDENTITY_REGISTRY,
        abi: registerAbi,
        functionName: "register",
        args: [agentURI],
      })
    : await walletClient.writeContract({
        address: IDENTITY_REGISTRY,
        abi: registerAbi,
        functionName: "register",
        args: [],
      });
  console.log("  tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Registration tx failed: ${hash}`);
  }

  const zero =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  let agentId: bigint | null = null;
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase() ||
      log.topics.length !== 4
    ) {
      continue;
    }
    // ERC-721 Transfer(from, to, tokenId) — mint has from = 0
    if (log.topics[1] === zero) {
      agentId = BigInt(log.topics[3]!);
      break;
    }
  }

  if (agentId == null) {
    console.log("Registered, but could not parse agentId from logs.");
    console.log("Check Celoscan Transfer tokenId on:", hash);
    return;
  }

  const url = `https://8004scan.io/agents/celo/${agentId}`;
  console.log("\n✅ Remifi registered");
  console.log("  agentId:", agentId.toString());
  console.log("  8004scan:", url);
  console.log(
    "  celoscan:",
    `https://celoscan.io/nft/${IDENTITY_REGISTRY}/${agentId}`,
  );
  console.log("\nAdd to Builders submission customFields.erc8004Url:");
  console.log(`  ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
