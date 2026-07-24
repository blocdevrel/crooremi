import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createRequesterClient, runCapHire } from "./lib/cap-hire.js";
import {
  defaultA2AFundAmount,
  splitTestRecipients,
  testEnsName,
  testRecipientA,
} from "./lib/fixtures.js";

loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

type HireService = "createPolicy" | "resolveEns" | "instantPay";

function resolveHireConfig(service: HireService): {
  serviceId: string;
  requirements: string;
  fund?: { fundAmount: string; fundToken: string };
  label: string;
} {
  const usdc = process.env.USDC_ADDRESS?.trim();
  const fundAmount = defaultA2AFundAmount();

  if (service === "createPolicy") {
    const serviceId = process.env.CROO_SERVICE_ID_CREATE_POLICY?.trim();
    if (!serviceId) throw new Error("Set CROO_SERVICE_ID_CREATE_POLICY");
    return {
      serviceId,
      label: "createPolicy",
      requirements: JSON.stringify({
        name: "A2A composability policy",
        recipients: splitTestRecipients().map(({ address, label, bps }) => ({
          address,
          label,
          bps,
        })),
      }),
    };
  }

  if (service === "resolveEns") {
    const serviceId = process.env.CROO_SERVICE_ID_RESOLVE_ENS?.trim();
    if (!serviceId) throw new Error("Set CROO_SERVICE_ID_RESOLVE_ENS");
    return {
      serviceId,
      label: "resolveEnsName",
      requirements: JSON.stringify({
        queries: [{ text: testEnsName() }],
      }),
    };
  }

  const serviceId = process.env.CROO_SERVICE_ID_INSTANT_USDC_PAY?.trim();
  if (!serviceId) throw new Error("Set CROO_SERVICE_ID_INSTANT_USDC_PAY");
  if (!usdc) throw new Error("Set USDC_ADDRESS for instantPay fund transfer");
  return {
    serviceId,
    label: "instantUsdcPay",
    requirements: JSON.stringify({
      to: testRecipientA(),
      amount: fundAmount,
    }),
    fund: { fundAmount, fundToken: usdc },
  };
}

async function main(): Promise<void> {
  const sdkKey =
    process.env.CROO_HIRE_SDK_KEY?.trim() ??
    process.env.CROO_THIRD_AGENT_SDK_KEY?.trim();
  if (!sdkKey) {
    throw new Error("Set CROO_HIRE_SDK_KEY or CROO_THIRD_AGENT_SDK_KEY");
  }

  const service = (process.env.A2A_HIRE_SERVICE?.trim() ??
    "createPolicy") as HireService;
  const hire = resolveHireConfig(service);

  const client = createRequesterClient(sdkKey);
  const stream = await client.connectWebSocket();

  try {
    const result = await runCapHire(
      client,
      stream,
      hire.label,
      hire.serviceId,
      hire.requirements,
      { fund: hire.fund, timeoutMs: 300_000 },
    );

    console.log(`Completed order ${result.orderId}`);
    if (result.delivery.policyId) {
      console.log(`policyId: ${result.delivery.policyId}`);
    }
    console.log("Run npm run export:orders to refresh proof\n");
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
