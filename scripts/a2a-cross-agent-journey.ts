import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { createRequesterClient, runCapHire } from "./lib/cap-hire.js";
import { defaultA2AFundAmount, splitTestRecipients } from "./lib/fixtures.js";

loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

const policyKey = process.env.CROO_POLICY_AGENT_SDK_KEY?.trim();
const executorKey = process.env.CROO_EXECUTOR_AGENT_SDK_KEY?.trim();
const policyServiceId = process.env.CROO_SERVICE_ID_CREATE_POLICY?.trim();
const executeServiceId = process.env.CROO_SERVICE_ID_EXECUTE_PAYMENT?.trim();
const usdcAddress = process.env.USDC_ADDRESS?.trim();
const fundAmount = defaultA2AFundAmount();

async function main(): Promise<void> {
  if (!policyKey) throw new Error("Set CROO_POLICY_AGENT_SDK_KEY");
  if (!executorKey) throw new Error("Set CROO_EXECUTOR_AGENT_SDK_KEY");
  if (policyKey === executorKey) {
    throw new Error(
      "CROO_POLICY_AGENT_SDK_KEY and CROO_EXECUTOR_AGENT_SDK_KEY must be different agents",
    );
  }
  if (!policyServiceId) throw new Error("Set CROO_SERVICE_ID_CREATE_POLICY");
  if (!executeServiceId) throw new Error("Set CROO_SERVICE_ID_EXECUTE_PAYMENT");
  if (!usdcAddress) throw new Error("Set USDC_ADDRESS");

  const recipients = splitTestRecipients().map(({ address, label, bps }) => ({
    address,
    label,
    bps,
  }));

  const policyClient = createRequesterClient(policyKey);
  const executorClient = createRequesterClient(executorKey);
  const policyStream = await policyClient.connectWebSocket();
  const executorStream = await executorClient.connectWebSocket();

  console.log("\nCross-agent A2A: policy agent → executor agent\n");

  try {
    console.log("Agent A · createPolicy");
    const policyResult = await runCapHire(
      policyClient,
      policyStream,
      "createPolicy",
      policyServiceId,
      JSON.stringify({
        name: "Cross-agent payroll policy",
        totalUsdc: fundAmount,
        recipients,
      }),
    );

    const policyId = String(policyResult.delivery.policyId);
    console.log(`  policyId: ${policyId}`);

    console.log("Agent B · executePaymentJob");
    const execResult = await runCapHire(
      executorClient,
      executorStream,
      "executePaymentJob",
      executeServiceId,
      JSON.stringify({ policyId, totalUsdc: fundAmount }),
      {
        fund: { fundAmount, fundToken: usdcAddress },
        timeoutMs: 300_000,
      },
    );

    const payout = execResult.delivery.recipients as
      | Array<{ label: string; txHash: string }>
      | undefined;
    console.log(`  order: ${execResult.orderId}`);
    for (const row of payout ?? []) {
      console.log(`  ${row.label}: ${row.txHash}`);
    }
    console.log("\nDone. Run npm run export:orders\n");
  } finally {
    policyStream.close();
    executorStream.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
