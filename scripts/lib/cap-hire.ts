import { AgentClient, DeliverableType, EventType } from "@croo-network/sdk";

export type CapOrderFund = {
  fundAmount: string;
  fundToken: string;
};

export type CapHireResult = {
  orderId: string;
  negotiationId: string;
  delivery: Record<string, unknown>;
};

export function createRequesterClient(sdkKey: string): AgentClient {
  return new AgentClient(
    {
      baseURL: process.env.CROO_API_URL ?? "https://api.croo.network",
      wsURL: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
      rpcURL: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    },
    sdkKey,
  );
}

export async function runCapHire(
  client: AgentClient,
  stream: Awaited<ReturnType<AgentClient["connectWebSocket"]>>,
  label: string,
  serviceId: string,
  requirements: string,
  options: {
    timeoutMs?: number;
    fund?: CapOrderFund;
  } = {},
): Promise<CapHireResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;

  return new Promise((resolveStep, rejectStep) => {
    let orderId: string | undefined;
    let negotiationId = "";
    let paid = false;
    let paymentStarted = false;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() =>
        rejectStep(new Error(`${label}: timed out after ${timeoutMs / 1000}s`)),
      );
    }, timeoutMs);

    const finishFromDelivery = async (id: string) => {
      const delivery = await client.getDelivery(id);
      const body =
        delivery.deliverableType === DeliverableType.Schema
          ? delivery.deliverableSchema
          : delivery.deliverableText;
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed.success === false) {
        throw new Error(String(parsed.error ?? "delivery failed"));
      }
      settle(() =>
        resolveStep({
          orderId: id,
          negotiationId,
          delivery: parsed,
        }),
      );
    };

    const payWhenReady = async (id: string) => {
      if (paymentStarted || paid) return;
      paymentStarted = true;
      orderId = id;

      try {
        for (let attempt = 0; attempt < 60; attempt++) {
          if (settled || paid) return;
          const order = await client.getOrder(id);
          if (order.status === "created") {
            paid = true;
            console.log(`  order ${id} — paying…`);
            const pay = await client.payOrder(id);
            console.log(`  pay tx: ${pay.txHash}`);
            return;
          }
          if (
            order.status === "paid" ||
            order.status === "delivered" ||
            order.status === "completed"
          ) {
            paid = true;
            return;
          }
          await new Promise((r) => setTimeout(r, 1_000));
        }
        settle(() =>
          rejectStep(
            new Error(`${label}: order ${id} never reached created status`),
          ),
        );
      } catch (err) {
        paymentStarted = false;
        settle(() => rejectStep(err instanceof Error ? err : new Error(String(err))));
      }
    };

    const onOrderCreated = async (event: {
      negotiation_id?: string;
      order_id?: string;
    }) => {
      if (event.negotiation_id !== negotiationId || !event.order_id) return;
      try {
        await payWhenReady(event.order_id);
      } catch (err) {
        settle(() => rejectStep(err instanceof Error ? err : new Error(String(err))));
      }
    };

    stream.on(EventType.OrderCreated, onOrderCreated);

    stream.on(EventType.OrderCompleted, async (event) => {
      if (!orderId || event.order_id !== orderId) return;
      try {
        await finishFromDelivery(orderId);
      } catch (err) {
        settle(() => rejectStep(err instanceof Error ? err : new Error(String(err))));
      }
    });

    const poll = async () => {
      const ticks = Math.ceil(timeoutMs / 5_000);
      for (let i = 0; i < ticks; i++) {
        if (settled) return;

        if (!paid && negotiationId) {
          try {
            const neg = await client.getNegotiation(negotiationId);
            if (neg.status === "rejected") {
              settle(() => rejectStep(new Error(`${label}: negotiation rejected`)));
              return;
            }
            if (neg.status === "accepted" && neg.orderId) {
              await payWhenReady(neg.orderId);
            }
          } catch (err) {
            if (!settled) {
              settle(() => rejectStep(err instanceof Error ? err : new Error(String(err))));
            }
            return;
          }
        }

        if (orderId) {
          try {
            const order = await client.getOrder(orderId);
            if (
              order.status === "completed" ||
              order.status === "delivered" ||
              order.status === "evaluating"
            ) {
              await finishFromDelivery(orderId);
              return;
            }
          } catch (err) {
            if (settled) return;
            if (err instanceof Error && err.message.includes("delivery failed")) {
              settle(() => rejectStep(err));
              return;
            }
          }
        }

        await new Promise((r) => setTimeout(r, 5_000));
      }
    };

    client
      .negotiateOrder({
        serviceId,
        requirements,
        ...(options.fund
          ? {
              fundAmount: options.fund.fundAmount,
              fundToken: options.fund.fundToken,
            }
          : {}),
      })
      .then((neg) => {
        negotiationId = neg.negotiationId;
        console.log(`  negotiation ${negotiationId}`);
        void poll();
      })
      .catch((err) =>
        settle(() => rejectStep(err instanceof Error ? err : new Error(String(err)))),
      );
  });
}
