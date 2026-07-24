import { EventType } from "@croo-network/sdk";
import { setProviderOnline, stopHealthServer } from "../health.js";
import { closePolicyDatabase } from "../policy/database.js";
import { createAgentClient } from "./client.js";
import {
  acceptNegotiation,
  deliverFailure,
  handleOrderPaid,
} from "./handlers.js";

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerShutdownHandlers(): void {
  const shutdown = async () => {
    console.log("[remifi] shutting down");
    setProviderOnline(false);
    stopHealthServer();
    await closePolicyDatabase().catch((err) => {
      console.error("[remifi] database close error:", err);
    });
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function runProviderSession(): Promise<void> {
  const client = createAgentClient();
  const stream = await client.connectWebSocket();

  console.log("[remifi] provider online — waiting for CAP orders");
  setProviderOnline(true);

  stream.on(EventType.NegotiationCreated, async (event) => {
    const negotiationId = event.negotiation_id;
    if (!negotiationId) return;

    try {
      const negotiation = await client.getNegotiation(negotiationId);
      await acceptNegotiation(client, negotiation);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[remifi] accept error:", message);
      try {
        await client.rejectNegotiation(
          negotiationId,
          message.slice(0, 500),
        );
        console.log(`[remifi] rejected negotiation ${negotiationId}`);
      } catch (rejectErr) {
        console.error("[remifi] failed to reject negotiation:", rejectErr);
      }
    }
  });

  stream.on(EventType.OrderPaid, async (event) => {
    const orderId = event.order_id;
    if (!orderId) return;

    console.log(`[remifi] order ${orderId} paid — executing service`);

    try {
      await handleOrderPaid(client, orderId);
      console.log(`[remifi] order ${orderId} delivered`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[remifi] deliver error for ${orderId}:`, message);
      try {
        await deliverFailure(client, orderId, message);
      } catch (deliverErr) {
        console.error("[remifi] failed to deliver error payload:", deliverErr);
      }
    }
  });

  stream.on(EventType.OrderCompleted, (event) => {
    console.log(`[remifi] order ${event.order_id} completed`);
  });

  await new Promise<void>(() => {});
}

export async function startProvider(): Promise<void> {
  registerShutdownHandlers();

  let delay = RECONNECT_DELAY_MS;

  while (true) {
    try {
      await runProviderSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[remifi] provider connect failed: ${message}`);
      console.error(`[remifi] retrying in ${delay / 1000}s (health server stays up)`);
      setProviderOnline(false);
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    }
  }
}
