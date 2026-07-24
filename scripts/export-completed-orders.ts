import { AgentClient } from "@croo-network/sdk";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env, getAgentStoreUrl } from "../src/config.js";
import {
  buildA2AReport,
  buildServiceNameMap,
  printA2AScorecard,
  type OrderRow,
} from "./lib/a2a-metrics.js";

const sdkKey = env.CROO_SDK_KEY?.trim();
if (!sdkKey) {
  throw new Error("CROO_SDK_KEY not set");
}

const client = new AgentClient(
  {
    baseURL: env.CROO_API_URL,
    wsURL: env.CROO_WS_URL,
    rpcURL: env.BASE_RPC_URL,
  },
  sdkKey,
);

async function listAllProviderOrders() {
  const all: Awaited<ReturnType<AgentClient["listOrders"]>> = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await client.listOrders({
      role: "provider",
      pageSize: 100,
      page,
    });
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function main(): Promise<void> {
  const orders = await listAllProviderOrders();
  const completed = orders.filter((o) => o.status === "completed");
  const serviceMap = buildServiceNameMap();

  const rows: OrderRow[] = [];
  for (const order of completed) {
    let deliveryOk = false;
    try {
      await client.getDelivery(order.orderId);
      deliveryOk = true;
    } catch {
      deliveryOk = false;
    }

    rows.push({
      orderId: order.orderId,
      serviceId: order.serviceId,
      serviceName: serviceMap.get(order.serviceId) ?? order.serviceId,
      status: order.status,
      requesterAgentId: order.requesterAgentId,
      requesterWallet: order.requesterWalletAddress,
      fundAmount: order.fundAmount,
      payTxHash: order.payTxHash,
      deliverTxHash: order.deliverTxHash,
      createdTime: order.createdTime,
      deliveryFetched: deliveryOk ? "yes" : "no",
    });
  }

  const report = buildA2AReport(
    orders,
    rows,
    env.CROO_AGENT_ID ?? "unknown",
    getAgentStoreUrl(),
  );

  printA2AScorecard(report);

  for (const row of rows.slice(0, 10)) {
    console.log(
      `${row.createdTime}  ${row.serviceName.padEnd(18)}  requester=${row.requesterAgentId?.slice(0, 8)}…`,
    );
  }
  if (rows.length > 10) {
    console.log(`… and ${rows.length - 10} more completed orders\n`);
  }

  const outPath = resolve(process.cwd(), "docs", "ORDERS.json");
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${outPath}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
