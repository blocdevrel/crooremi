import { startProvider } from "./cap/server.js";
import { validateRouterDeployment } from "./chain/router.js";
import { startHealthServer } from "./health.js";
import { closePolicyDatabase, initPolicyDatabase } from "./policy/database.js";
import { registerProcessHandlers, validateStartup } from "./startup.js";

registerProcessHandlers();

async function main(): Promise<void> {
  try {
    validateStartup();
  } catch (err) {
    console.error("[remifi] startup validation failed:", err);
    process.exit(1);
  }

  startHealthServer();

  try {
    await initPolicyDatabase();
  } catch (err) {
    console.error("[remifi] database init failed:", err);
    process.exit(1);
  }

  try {
    await validateRouterDeployment();
  } catch (err) {
    console.error("[remifi] router validation failed:", err);
    process.exit(1);
  }

  await startProvider();
}

main().catch(async (err) => {
  console.error("[remifi] fatal:", err);
  await closePolicyDatabase().catch(() => {});
  process.exit(1);
});
