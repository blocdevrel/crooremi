import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = resolve(process.cwd(), ".env");
loadEnv({ path: envPath });

function upsertEnv(key: string, value: string) {
  let raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(raw)) {
    raw = raw.replace(re, line);
  } else {
    raw = `${raw.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, raw, "utf8");
}

const force = process.argv.includes("--force");
const existing = process.env.AGENT_PRIVATE_KEY?.trim();
if (existing && !force) {
  const account = privateKeyToAccount(
    (existing.startsWith("0x") ? existing : `0x${existing}`) as `0x${string}`,
  );
  upsertEnv("AGENT_ADDRESS", account.address);
  if (!process.env.X402_PAY_TO?.trim()) {
    upsertEnv("X402_PAY_TO", account.address);
  }
  console.log("[wallet] already set — refreshed AGENT_ADDRESS / X402_PAY_TO");
  console.log("[wallet] AGENT_ADDRESS=", account.address);
  console.log("[wallet] pass --force to rotate");
  process.exit(0);
}

const key = generatePrivateKey();
const account = privateKeyToAccount(key);
upsertEnv("AGENT_PRIVATE_KEY", key);
upsertEnv("AGENT_ADDRESS", account.address);
upsertEnv("X402_PAY_TO", account.address);

console.log("[wallet] wrote AGENT_PRIVATE_KEY to .env (not printed)");
console.log("[wallet] AGENT_ADDRESS=", account.address);
console.log("[wallet] X402_PAY_TO=", account.address);
console.log("[wallet] Fund this address with USDC + CELO on Celo mainnet.");
