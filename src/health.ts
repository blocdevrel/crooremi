import { createServer, type Server } from "node:http";
import { env } from "./config.js";
import { isRouterConfigured, getRouterAddress } from "./chain/router.js";
import { getPayoutWalletAddress } from "./chain/payout-wallet.js";
import { isDatabaseReady } from "./policy/database.js";
import { createAgentClient } from "./cap/client.js";

function requiresOrderLedger(): boolean {
  return Boolean(
    env.CROO_SERVICE_ID_EXECUTE_PAYMENT?.trim() ||
      env.CROO_SERVICE_ID_INSTANT_USDC_PAY?.trim(),
  );
}

let providerOnline = false;
let server: Server | undefined;

export function setProviderOnline(online: boolean): void {
  providerOnline = online;
}

export type HealthSnapshot = {
  ok: boolean;
  service: string;
  provider: "online" | "connecting";
  checks: {
    database: "ok" | "disabled" | "not_ready";
    router: "ok" | "disabled" | "configured";
    payoutWallet: "ok" | "missing";
    crooApi: "ok" | "error" | "skipped";
    capWebSocket: "online" | "connecting";
  };
};

async function buildHealthSnapshot(): Promise<HealthSnapshot> {
  const checks: HealthSnapshot["checks"] = {
    database: env.DATABASE_URL
      ? isDatabaseReady()
        ? "ok"
        : "not_ready"
      : requiresOrderLedger()
        ? "not_ready"
        : "disabled",
    router: isRouterConfigured() ? "configured" : "disabled",
    payoutWallet: getPayoutWalletAddress() ? "ok" : "missing",
    crooApi: "skipped",
    capWebSocket: providerOnline ? "online" : "connecting",
  };

  if (env.CROO_SDK_KEY?.trim()) {
    try {
      const client = createAgentClient();
      await client.listOrders({ role: "provider", pageSize: 1 });
      checks.crooApi = "ok";
    } catch {
      checks.crooApi = "error";
    }
  }

  const ok =
    providerOnline &&
    checks.crooApi !== "error" &&
    (checks.database !== "not_ready") &&
    (checks.router !== "configured" || checks.payoutWallet === "ok");

  return {
    ok,
    service: "remifi-cap-provider",
    provider: providerOnline ? "online" : "connecting",
    checks,
  };
}

export function startHealthServer(port = Number(process.env.PORT) || 3001): Server {
  server = createServer(async (req, res) => {
    const path = req.url?.split("?")[0];
    if (path === "/health" || path === "/") {
      const snapshot = await buildHealthSnapshot();
      res.writeHead(snapshot.ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snapshot));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, "0.0.0.0", () => {
    const router = getRouterAddress();
    console.log(`[remifi] health server listening on 0.0.0.0:${port}`, {
      router: router ?? "disabled",
    });
  });

  return server;
}

export function stopHealthServer(): void {
  server?.close();
}
