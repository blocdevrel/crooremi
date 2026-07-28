/**
 * Local integration test for schedules, quote, heartbeat (no secrets logged).
 * Usage: npm run test:volume-engine -- [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

const API = process.argv[2] ?? "http://localhost:3001";
const KEY = process.env.EXECUTE_API_KEY ?? "";

function pass(label: string, detail?: string) {
  console.log(`✓ ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(label: string, detail?: string): never {
  console.error(`✗ ${label}${detail ? `: ${detail}` : ""}`);
  process.exit(1);
}

async function main() {
  console.log(`Testing Remifi volume engine at ${API}\n`);

  const healthRes = await fetch(`${API}/api/health`);
  if (!healthRes.ok) fail("health", String(healthRes.status));
  const health = (await healthRes.json()) as {
    x402?: { enabled?: boolean };
    usdcBalanceFormatted?: string;
  };
  pass("health", `x402=${health.x402?.enabled} agent=${health.usdcBalanceFormatted} USDC`);

  const discoverRes = await fetch(`${API}/api/schedules?discover=1`);
  const discover = (await discoverRes.json()) as { name?: string; path?: string };
  if (!discoverRes.ok || discover.name !== "payrollSchedules") {
    fail("schedules discover", JSON.stringify(discover).slice(0, 120));
  }
  pass("schedules discover", discover.path);

  const quote402 = await fetch(`${API}/api/quote?policyId=x&amount=10000`);
  if (quote402.status !== 402 && quote402.status !== 400) {
    fail("quote requires payment", `got ${quote402.status}`);
  }
  pass("quote gate", `HTTP ${quote402.status} without X-PAYMENT`);

  const policyRes = await fetch(`${API}/api/policies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `test-${Date.now()}`,
      recipients: [
        {
          address: "0x23282e795ea127F794Ed5F3D2c6c0a47aFeA524F",
          bps: 10_000,
        },
      ],
    }),
  });
  const policy = (await policyRes.json()) as { policyId?: string; error?: string };
  if (!policyRes.ok || !policy.policyId) {
    fail("create policy", policy.error ?? String(policyRes.status));
  }
  pass("create policy", policy.policyId!.slice(0, 12) + "…");

  const scheduleRes = await fetch(`${API}/api/schedules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      policyId: policy.policyId,
      amount: "10000",
      intervalMinutes: 20,
      name: "integration-test",
    }),
  });
  const schedule = (await scheduleRes.json()) as {
    scheduleId?: string;
    error?: string;
  };
  if (!scheduleRes.ok || !schedule.scheduleId) {
    fail("create schedule", schedule.error ?? String(scheduleRes.status));
  }
  pass("create schedule", schedule.scheduleId!.slice(0, 12) + "…");

  const listRes = await fetch(`${API}/api/schedules`);
  const list = (await listRes.json()) as { schedules?: unknown[] };
  if (!listRes.ok || !Array.isArray(list.schedules) || list.schedules.length === 0) {
    fail("list schedules");
  }
  pass("list schedules", `${list.schedules!.length} active`);

  const hbMeta = await fetch(`${API}/api/schedules/heartbeat`);
  const hbInfo = (await hbMeta.json()) as { service?: string };
  if (!hbMeta.ok || hbInfo.service !== "remifi-heartbeat") fail("heartbeat GET");
  pass("heartbeat GET");

  const noKey = await fetch(`${API}/api/schedules/heartbeat`, { method: "POST" });
  if (KEY && noKey.ok) fail("heartbeat auth", "accepted without key");
  pass("heartbeat auth", KEY ? `rejects missing key (${noKey.status})` : "skipped (no EXECUTE_API_KEY)");

  if (KEY) {
    const hb = await fetch(`${API}/api/schedules/heartbeat`, {
      method: "POST",
      headers: { "x-api-key": KEY },
    });
    const hbBody = (await hb.json()) as {
      due?: number;
      completed?: number;
      failed?: number;
      results?: Array<{ status: string; error?: string }>;
    };
    if (!hb.ok) fail("heartbeat run", JSON.stringify(hbBody).slice(0, 200));
    pass(
      "heartbeat run",
      `due=${hbBody.due} completed=${hbBody.completed} failed=${hbBody.failed}`,
    );
    if (hbBody.failed && hbBody.failed > 0) {
      const err = hbBody.results?.find((r) => r.status === "failed")?.error;
      console.log(`  note: schedule run failed (expected if agent underfunded): ${err}`);
    }

    const quoteRes = await fetch(
      `${API}/api/quote?policyId=${policy.policyId}&amount=10000`,
      { headers: { "x-api-key": KEY } },
    );
    const quote = (await quoteRes.json()) as {
      recipientCount?: number;
      x402SettlementTxHash?: string;
      error?: string;
    };
    if (!quoteRes.ok) fail("quote with hire", quote.error);
    pass(
      "quote with x402 hire",
      `${quote.recipientCount} legs x402=${quote.x402SettlementTxHash?.slice(0, 10) ?? "none"}…`,
    );
  }

  console.log("\nAll volume-engine checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
