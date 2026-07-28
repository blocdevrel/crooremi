/**
 * Tagged USDC transfer smoke.
 * Usage: npm run smoke:transfer -- 0xRecipient [amountBaseUnits]
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) {
    loadEnv({ path: p, override: false });
  }
}

async function main() {
  const { verifyAttribution, assertTagPresent } = await import("../lib/attribution");
  const { env } = await import("../lib/config");
  const { sendTaggedUsdcTransfer } = await import("../lib/payout");
  const { normalizeAddress } = await import("../lib/policy/validate");

  const toRaw = process.argv[2];
  const amountRaw = process.argv[3] ?? "10000";

  if (!toRaw) {
    console.error("Usage: npm run smoke:transfer -- <toAddress> [amountBaseUnits]");
    process.exit(1);
  }

  if (!env.ATTRIBUTION_TAG) {
    throw new Error("Set ATTRIBUTION_TAG before smoke test");
  }
  if (!env.AGENT_PRIVATE_KEY && !env.DEV_MOCK_PAYOUT) {
    throw new Error("Set AGENT_PRIVATE_KEY (or DEV_MOCK_PAYOUT=true)");
  }

  const to = normalizeAddress(toRaw);
  const amount = BigInt(amountRaw);

  console.log("[smoke] sending tagged USDC", {
    to,
    amount: amount.toString(),
    tag: env.ATTRIBUTION_TAG,
  });

  const result = await sendTaggedUsdcTransfer(to, amount);
  console.log("[smoke] tx", result);

  if (!env.DEV_MOCK_PAYOUT) {
    const decoded = await verifyAttribution(result.txHash);
    console.log("[smoke] verifyTx", decoded);
    assertTagPresent(decoded);
    console.log("[smoke] attribution OK");
  } else {
    console.log("[smoke] mock mode — skipped verifyTx");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
