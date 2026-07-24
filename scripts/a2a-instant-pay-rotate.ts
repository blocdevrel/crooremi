import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createRequesterClient, runCapHire } from "./lib/cap-hire.js";
import { defaultA2AFundAmount } from "./lib/fixtures.js";

loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SLOT_COUNT = 10;
/** Default gap between hires: 10 minutes */
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

function envSlots(prefix: string): string[] {
  const values: string[] = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const v = process.env[`${prefix}${i}`]?.trim();
    if (v) values.push(v);
  }
  return values;
}

function resolveIntervalMs(): number {
  const raw =
    process.env.A2A_HIRE_INTERVAL_MS?.trim() ??
    process.env.A2A_HIRE_INTERVAL_MINUTES?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;

  if (process.env.A2A_HIRE_INTERVAL_MS?.trim()) {
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("A2A_HIRE_INTERVAL_MS must be a non-negative number");
    }
    return ms;
  }

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error("A2A_HIRE_INTERVAL_MINUTES must be a non-negative number");
  }
  return minutes * 60_000;
}

function resolveRecipients(): `0x${string}`[] {
  const fromSlots = envSlots("RECIPIENT_");
  const fromCsv = (process.env.RECIPIENTS ?? "")
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const raw = fromSlots.length > 0 ? fromSlots : fromCsv;

  if (raw.length === 0) {
    throw new Error("Set RECIPIENT_1…10 (at least one 0x address)");
  }

  const out: `0x${string}`[] = [];
  for (const addr of raw) {
    if (!ADDRESS_RE.test(addr)) {
      throw new Error(`Invalid recipient address: ${addr}`);
    }
    out.push(addr as `0x${string}`);
  }
  return out;
}

function resolveHireSdkKeys(): string[] {
  const fromCli = process.argv
    .slice(2)
    .map((k) => k.trim())
    .filter(Boolean);
  if (fromCli.length > 0) return [...new Set(fromCli)];

  const fromSlots = envSlots("CROO_HIRE_SDK_KEY_");
  if (fromSlots.length > 0) return [...new Set(fromSlots)];

  const fromList = (process.env.CROO_HIRE_SDK_KEYS ?? "")
    .split(/[,;\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (fromList.length > 0) return [...new Set(fromList)];

  throw new Error(
    "Set CROO_HIRE_SDK_KEY_1…10 (at least one croo_sk_… requester key)",
  );
}

function maskKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function hireInstantPay(
  sdkKey: string,
  to: `0x${string}`,
  index: number,
  total: number,
) {
  const serviceId = process.env.CROO_SERVICE_ID_INSTANT_USDC_PAY?.trim();
  const usdc = process.env.USDC_ADDRESS?.trim();
  const fundAmount = defaultA2AFundAmount();

  if (!serviceId) throw new Error("Set CROO_SERVICE_ID_INSTANT_USDC_PAY");
  if (!usdc) throw new Error("Set USDC_ADDRESS for instantPay fund transfer");

  console.log(
    `\n[${index + 1}/${total}] requester ${maskKey(sdkKey)} → ${to}`,
  );

  const client = createRequesterClient(sdkKey);
  const stream = await client.connectWebSocket();

  try {
    const result = await runCapHire(
      client,
      stream,
      "instantUsdcPay",
      serviceId,
      JSON.stringify({ to, amount: fundAmount }),
      {
        fund: { fundAmount, fundToken: usdc },
        timeoutMs: 300_000,
      },
    );

    console.log(`  completed order ${result.orderId}`);
    if (result.delivery.fundTxHash) {
      console.log(`  fundTxHash: ${result.delivery.fundTxHash}`);
    }
    return result.orderId;
  } finally {
    stream.close();
  }
}

/**
 * Build 1:1 pairs for filled slots (agent N → recipient N).
 * Extra agents wrap over recipients; unpaired recipients are skipped.
 */
function buildPairs(
  keys: string[],
  recipients: `0x${string}`[],
): Array<{ sdkKey: string; to: `0x${string}` }> {
  return keys.map((sdkKey, i) => ({
    sdkKey,
    to: recipients[i % recipients.length]!,
  }));
}

async function main(): Promise<void> {
  const keys = resolveHireSdkKeys();
  const recipients = resolveRecipients();
  const intervalMs = resolveIntervalMs();
  const pairs = buildPairs(keys, recipients);

  console.log(
    `Sequential instantUsdcPay: ${pairs.length} hire(s), ${formatDuration(intervalMs)} between each`,
  );

  const orders: string[] = [];
  const failures: Array<{ key: string; error: string }> = [];

  for (let i = 0; i < pairs.length; i++) {
    const { sdkKey, to } = pairs[i]!;
    try {
      const orderId = await hireInstantPay(sdkKey, to, i, pairs.length);
      orders.push(orderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${message}`);
      failures.push({ key: maskKey(sdkKey), error: message });
    }

    if (i < pairs.length - 1 && intervalMs > 0) {
      console.log(
        `\nWaiting ${formatDuration(intervalMs)} before next hire…`,
      );
      await sleep(intervalMs);
    }
  }

  console.log(`\nDone: ${orders.length} ok, ${failures.length} failed`);
  for (const id of orders) console.log(`  order ${id}`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f.key}: ${f.error}`);
    process.exit(1);
  }
  console.log("Run npm run export:orders to refresh proof\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
