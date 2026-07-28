/**
 * x402 hire + tagged USDC send smoke.
 * Usage: npm run smoke:x402 -- 0xRecipient [amountBaseUnits]
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

async function main() {
  const toRaw = process.argv[2];
  const amountRaw = process.argv[3] ?? "10000";
  if (!toRaw) {
    console.error("Usage: npm run smoke:x402 -- <toAddress> [amountBaseUnits]");
    process.exit(1);
  }

  const { requireAgentAccount } = await import("../lib/chain/clients");
  const { env } = await import("../lib/config");
  const { normalizeAddress } = await import("../lib/policy/validate");
  const { buildHireRequirements, settleX402Hire } = await import("../lib/x402");
  const { createXPaymentHeader } = await import("../lib/x402/sign-payment");
  const { sendTaggedUsdcTransfer } = await import("../lib/payout");
  const { verifyAttribution, assertTagPresent } = await import(
    "../lib/attribution",
  );

  if (!env.X402_API_KEY) {
    throw new Error("Set X402_API_KEY from https://x402.celo.org");
  }

  const to = normalizeAddress(toRaw);
  const amount = BigInt(amountRaw);
  const account = requireAgentAccount();
  const requirements = buildHireRequirements("/api/pay");

  console.log("[smoke:x402] signing hire", {
    from: account.address,
    payTo: requirements.payTo,
    hire: requirements.maxAmountRequired,
    network: requirements.network,
  });

  const { header, payload } = await createXPaymentHeader(account, requirements);
  console.log("[smoke:x402] authorization from", payload.payload.authorization.from);

  const hire = await settleX402Hire(header, requirements);
  console.log("[smoke:x402] hire settled", hire);

  console.log("[smoke:x402] tagged send", { to, amount: amount.toString() });
  const paid = await sendTaggedUsdcTransfer(to, amount);
  console.log("[smoke:x402] pay tx", paid);

  if (!env.DEV_MOCK_PAYOUT) {
    const decoded = await verifyAttribution(paid.txHash);
    console.log("[smoke:x402] verifyTx", decoded);
    assertTagPresent(decoded);
    console.log("[smoke:x402] attribution OK");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
