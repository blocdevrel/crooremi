import { resolve } from "node:path";
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env"), override: false });
process.env.CROO_SDK_KEY ??= "croo_sk_verify_llm_test_key_placeholder_00";
process.env.TEST_RECIPIENT_A ??= "0x0000000000000000000000000000000000000001";
process.env.TEST_RECIPIENT_B ??= "0x0000000000000000000000000000000000000002";
process.env.DEV_MOCK_ENS_SUBNAMES = "true";

const { initPolicyDatabase } = await import("../src/policy/database.js");
const { testRecipientA, testRecipientB } = await import("./lib/fixtures.js");
const { interpretPolicyFromRequirements } = await import("../src/policy/interpreter.js");
const { parseExecutePayrollPlan } = await import("../src/policy/execute-resolver.js");
const { createEnsFromRequirements } = await import("../src/policy/ens-service.js");
const { resolveEnsFromRequirements } = await import("../src/policy/ens-resolve.js");
const { interpretEnsResolveText } = await import("../src/policy/llm.js");
const { savePolicy, toStoredPolicy } = await import("../src/policy/store.js");
const { hasLlmKeys } = await import("../src/policy/requirements-utils.js");

const WALLET_A = testRecipientA();
const WALLET_B = testRecipientB();

let passed = 0;

function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function testCreatePolicyNl(): Promise<string> {
  const delivery = await interpretPolicyFromRequirements(
    `Under org verifyllm, split 30% to wallet-a at ${WALLET_A} and 60% to wallet-b at ${WALLET_B}`,
  );

  assert.match(delivery.policyId, /^pol_[a-f0-9]+$/);
  assert.equal(delivery.allocatedBps, 9000);
  assert.equal(delivery.policy.recipients.length, 2);
  assert.ok(delivery.executionGuide?.payroll);
  ok("createPolicy — plain English → policyId + recipients + executionGuide");

  await savePolicy(toStoredPolicy(delivery));
  return delivery.policyId;
}

async function testExecutePayrollNl(policyId: string): Promise<void> {
  const plan = await parseExecutePayrollPlan(
    `Execute payroll for policy ${policyId} with 1 USDC total principal`,
  );

  assert.equal(plan.policyId, policyId);
  assert.equal(plan.totalUsdc, "1000000");
  assert.equal(plan.legs.length, 2);
  assert.equal(plan.fundAmount, "900000");
  ok("executePaymentJob — natural language → policyId + totalUsdc + legs");
}

async function testCreateEnsNl(): Promise<void> {
  const delivery = await createEnsFromRequirements(
    `Register org verifyllm with subname payroll pointing to ${WALLET_A}`,
  );

  const ens = "names" in delivery ? delivery.names[0]?.ens : delivery.ens;
  assert.ok(ens?.includes("verifyllm"));
  ok("createEnsName — natural language → Base name delivery");
}

async function testResolveEnsNl(): Promise<void> {
  const draft = await interpretEnsResolveText(
    "Forward lookup vitalik.eth and reverse lookup 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  );

  assert.ok(draft.queries.length >= 2);
  assert.ok(draft.queries.some((q) => q.value.toLowerCase().includes("vitalik")));
  assert.ok(
    draft.queries.some((q) =>
      q.value.toLowerCase().startsWith("0x"),
    ),
  );
  ok("resolveEnsName — LangChain structures forward + reverse queries");

  const delivery = await resolveEnsFromRequirements(
    JSON.stringify({ text: "vitalik.eth" }),
  );
  assert.equal(delivery.results[0]?.direction, "forward");
  ok("resolveEnsName — end-to-end forward lookup delivery shape");
}

async function testCreatePolicyTextWrapper(): Promise<void> {
  const delivery = await interpretPolicyFromRequirements(
    JSON.stringify({
      text: `Split 50% to ops at ${WALLET_A} and 50% to team at ${WALLET_B}`,
      totalUsdc: "2000000",
    }),
  );

  assert.equal(delivery.allocatedBps, 10_000);
  assert.equal(delivery.executionGuide?.totalUsdc, "2000000");
  ok("createPolicy — { text } wrapper routes to LangChain");
}

async function main(): Promise<void> {
  console.log("\nRemifi LangChain verification (all four services)\n");

  if (!hasLlmKeys()) {
    console.error("FAILED: Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env");
    process.exit(1);
  }

  const provider = process.env.ANTHROPIC_API_KEY ? "Anthropic" : "OpenAI";
  console.log(`  Using ${provider}\n`);

  await initPolicyDatabase();

  const policyId = await testCreatePolicyNl();
  await testExecutePayrollNl(policyId);
  await testCreateEnsNl();
  await testResolveEnsNl();
  await testCreatePolicyTextWrapper();

  console.log(`\n${passed} LangChain checks passed.\n`);
}

main().catch((err) => {
  console.error("\nFAILED:", err.message ?? err);
  process.exit(1);
});
