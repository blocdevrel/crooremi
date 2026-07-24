import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { AgentClient, DeliverableType, EventType } from "@croo-network/sdk";
import { defaultJourneyFundAmount, splitTestRecipients } from "./lib/fixtures.js";

loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

const sdkKey = process.env.CROO_REQUESTER_SDK_KEY?.trim();
const ensServiceId = process.env.CROO_SERVICE_ID_CREATE_ENS?.trim();
const policyServiceId = process.env.CROO_SERVICE_ID_CREATE_POLICY?.trim();
const executeServiceId = process.env.CROO_SERVICE_ID_EXECUTE_PAYMENT?.trim();

const JOURNEY_ORG =
  process.env.JOURNEY_ORG?.trim() ?? `journey${Date.now().toString(36).slice(-5)}`;
const SKIP_ENS = process.env.JOURNEY_SKIP_ENS === "1";
const FUND_AMOUNT = defaultJourneyFundAmount();
const RECIPIENTS = splitTestRecipients().map(({ subname, address, label, bps }) => ({
  subname: subname!,
  address,
  label,
  bps,
}));

type ExecutionPayrollGuide = {
  requirements: { policyId: string; totalUsdc: string };
  fundAmount: string;
  fundToken: string;
  recipientCount: number;
};

type JourneyNextStep = {
  service: string;
  requirements: Record<string, unknown>;
};

type CapOrderFund = {
  fundAmount: string;
  fundToken: string;
};

async function runCapOrder(
  client: AgentClient,
  stream: Awaited<ReturnType<AgentClient["connectWebSocket"]>>,
  label: string,
  serviceId: string,
  requirements: string,
  timeoutMs = 180_000,
  fund?: CapOrderFund,
): Promise<Record<string, unknown>> {
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
      settle(() => rejectStep(new Error(`${label}: timed out after ${timeoutMs / 1000}s`)));
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
      settle(() => resolveStep(parsed));
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
          rejectStep(new Error(`${label}: order ${id} never reached created status`)),
        );
      } catch (err) {
        paymentStarted = false;
        settle(() => rejectStep(err instanceof Error ? err : new Error(String(err))));
      }
    };

    const onOrderCreated = async (event: { negotiation_id?: string; order_id?: string }) => {
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
        ...(fund ? { fundAmount: fund.fundAmount, fundToken: fund.fundToken } : {}),
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

function buildEnsRequirements(org: string): string {
  return JSON.stringify({
    org,
    names: RECIPIENTS.map((r) => ({
      subname: r.subname,
      address: r.address,
    })),
  });
}

function buildPolicyRequirements(totalUsdc: string): string {
  return JSON.stringify({
    totalUsdc,
    name: "Live test split",
    recipients: RECIPIENTS.map((r) => ({
      address: r.address,
      label: r.label,
      bps: r.bps,
    })),
  });
}

async function main(): Promise<void> {
  if (!sdkKey) throw new Error("Set CROO_REQUESTER_SDK_KEY");
  if (!ensServiceId) throw new Error("Set CROO_SERVICE_ID_CREATE_ENS");
  if (!policyServiceId) throw new Error("Set CROO_SERVICE_ID_CREATE_POLICY");
  if (!executeServiceId) throw new Error("Set CROO_SERVICE_ID_EXECUTE_PAYMENT");

  const usdcAddress = process.env.USDC_ADDRESS?.trim();
  if (!usdcAddress) throw new Error("Set USDC_ADDRESS for execution fund transfers");

  const client = new AgentClient(
    {
      baseURL: process.env.CROO_API_URL ?? "https://api.croo.network",
      wsURL: process.env.CROO_WS_URL ?? "wss://api.croo.network/ws",
      rpcURL: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    },
    sdkKey,
  );

  const stream = await client.connectWebSocket();
  console.log("\nFull journey — ENS → Policy → Execution\n");
  console.log(`Org: ${JOURNEY_ORG}`);
  console.log(`Principal (totalUsdc): ${FUND_AMOUNT}`);
  console.log(`Skip ENS: ${SKIP_ENS}\n`);

  let policyRequirements = buildPolicyRequirements(FUND_AMOUNT);
  let step = 1;

  try {
    if (!SKIP_ENS) {
      console.log(`── Step ${step} · ENS Payout Identity ──`);
      const ensDelivery = await runCapOrder(
        client,
        stream,
        "createEnsName",
        ensServiceId,
        buildEnsRequirements(JOURNEY_ORG),
        600_000,
      );

      const names =
        "names" in ensDelivery
          ? (ensDelivery.names as Array<{ ens: string }>)
          : [{ ens: String(ensDelivery.ens) }];
      for (const n of names) {
        console.log(`  ✓ ${n.ens}`);
      }

      const guide = ensDelivery.journeyGuide as
        | { nextStep: JourneyNextStep }
        | undefined;
      if (guide?.nextStep?.requirements) {
        policyRequirements = JSON.stringify(guide.nextStep.requirements);
        console.log("  → policy requirements ready from journeyGuide\n");
      } else {
        console.log("");
      }
      step += 1;
    }

    console.log(`── Step ${step} · USDC Split Policy ──`);
    const policyDelivery = await runCapOrder(
      client,
      stream,
      "createPolicy",
      policyServiceId,
      policyRequirements,
    );
    const policyId = String(policyDelivery.policyId);
    console.log(`  ✓ policyId: ${policyId}`);

    const recipients = policyDelivery.policy as
      | { recipients: Array<{ ens?: string }> }
      | undefined;
    for (const r of recipients?.recipients ?? []) {
      if (r.ens) console.log(`  ✓ linked ${r.ens}`);
    }

    const execGuide = policyDelivery.executionGuide as
      | { payroll: ExecutionPayrollGuide }
      | undefined;
    const payroll = execGuide?.payroll;

    if (!payroll) {
      throw new Error("Policy delivery missing executionGuide.payroll");
    }

    console.log(
      `  → payroll: ${payroll.recipientCount} recipient(s), fund ${payroll.fundAmount} base units\n`,
    );
    step += 1;

    console.log(`── Step ${step} · Execute Payroll ──`);
    const execDelivery = await runCapOrder(
      client,
      stream,
      "execute-payroll",
      executeServiceId,
      JSON.stringify(payroll.requirements),
      300_000,
      { fundAmount: payroll.fundAmount, fundToken: payroll.fundToken },
    );
    const txHashes = execDelivery.txHashes as string[] | undefined;
    console.log(`  ✓ ${txHashes?.length ?? 0} payout tx(s): ${txHashes?.join(", ") ?? "n/a"}\n`);

    console.log("Full journey completed (ENS → Policy → Payroll).\n");
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message ?? err);
  process.exit(1);
});
