/**
 * Run due recurring payroll schedules once (for cron / Railway heartbeat).
 * Usage: npm run heartbeat
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

async function main() {
  const { runDueSchedules } = await import("../lib/schedules/heartbeat");
  const result = await runDueSchedules();
  console.log("[remifi:heartbeat]", JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
