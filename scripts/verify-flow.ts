import { resolve } from "node:path";
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env"), override: false });
process.env.CROO_SDK_KEY ??= "croo_sk_verify_flow_test_key_placeholder_00";
process.env.TEST_RECIPIENT_A ??= "0x0000000000000000000000000000000000000001";
process.env.TEST_RECIPIENT_B ??= "0x0000000000000000000000000000000000000002";
process.env.TEST_ENS_NAME ??= "example.base.eth";
process.env.DEV_MOCK_ENS_SUBNAMES = "true";
process.env.DEV_MOCK_PAYROLL_SETTLEMENT = "true";

const { testRecipientA, testRecipientB, testEnsName } = await import("./lib/fixtures.js");

const { initPolicyDatabase } = await import("../src/policy/database.js");

const {
  interpretPolicyFromRequirements,
} = await import("../src/policy/interpreter.js");
const { parseExecutePayrollPlan } = await import("../src/policy/execute-resolver.js");
const { buildExecuteBatchPlan } = await import("../src/policy/execute-batch.js");
const { parseEnsResolveQueries } = await import("../src/policy/ens-resolve.js");
const { savePolicy, loadPolicy, toStoredPolicy } = await import("../src/policy/store.js");
const {
  attachEnsJourneyGuide,
  attachPolicyJourneyGuide,
  buildPolicyRequirementsFromEns,
} = await import("../src/policy/journey-guide.js");

const ADDR_A = testRecipientA();
const ADDR_B = testRecipientB();
const ENS_NAME = testEnsName();

const RECIPIENTS = [
  {
    address: testRecipientA(),
    label: "wallet-a",
    bps: 3000,
    subname: "wallet-a",
  },
  {
    address: testRecipientB(),
    label: "wallet-b",
    bps: 6000,
    subname: "wallet-b",
  },
];

let passed = 0;

function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function testPolicyCreationAndStore(): Promise<string> {
  const requirements = JSON.stringify({
    totalUsdc: "1000000",
    name: "Verify split",
    recipients: RECIPIENTS.map(({ address, label, bps }) => ({
      address,
      label,
      bps,
    })),
  });

  const delivery = await interpretPolicyFromRequirements(requirements);

  assert.match(delivery.policyId, /^pol_[a-f0-9]+$/);
  assert.equal(delivery.allocatedBps, 9000);
  assert.equal(delivery.remainderBps, 1000);
  assert.ok(delivery.executionGuide);
  assert.equal(delivery.executionGuide!.payroll.recipientCount, 2);
  assert.equal(delivery.executionGuide!.payroll.fundAmount, "900000");
  ok("createPolicy returns policyId, partial bps, executionGuide.payroll");

  const payroll = delivery.executionGuide!.payroll;
  assert.equal(payroll.requirements.policyId, delivery.policyId);
  assert.equal(payroll.recipients[0]!.amount, "300000");
  assert.equal(payroll.recipients[1]!.amount, "600000");
  ok("executionGuide payroll computes fund amount and per-recipient amounts");

  delivery.journeyGuide = attachPolicyJourneyGuide(delivery);
  assert.equal(delivery.journeyGuide.step, 2);
  ok("policy journeyGuide attached (step 2)");

  await savePolicy(toStoredPolicy(delivery));
  const loaded = await loadPolicy(delivery.policyId);
  assert.ok(loaded);
  assert.equal(loaded!.policyId, delivery.policyId);
  assert.equal(loaded!.policy.recipients.length, 2);
  ok("policy store save/load roundtrip");

  return delivery.policyId;
}

async function testExecutePayrollPlan(policyId: string): Promise<void> {
  const plan = await parseExecutePayrollPlan(
    JSON.stringify({
      policyId,
      totalUsdc: "1000000",
    }),
  );

  assert.equal(plan.legs.length, 2);
  assert.equal(plan.fundAmount, "900000");
  assert.equal(plan.legs[0]!.recipient.label, "wallet-a");
  assert.equal(plan.legs[1]!.recipient.amount, "600000");
  ok("payroll execute parses policyId + totalUsdc into all legs");

  const fromStore = await buildExecuteBatchPlan({
    policyId,
    totalUsdc: "1000000",
  });
  assert.equal(fromStore.legs.length, 2);
  ok("buildExecuteBatchPlan loads policy from store");
}

async function testPayrollDisbursement(policyId: string): Promise<void> {
  const plan = await buildExecuteBatchPlan({
    policyId,
    totalUsdc: "1000000",
  });
  const { executePayrollSettlement } = await import("../src/chain/payroll-settlement.js");

  const delivery = await executePayrollSettlement(
    {
      payTxHash: `0x${"a".repeat(64)}`,
      providerFundAddress: `0x${"b".repeat(40)}`,
      fundAmount: plan.fundAmount,
    } as import("@croo-network/sdk").Order,
    plan,
  );

  assert.equal(delivery.settlement, "mock_payroll");
  assert.equal(delivery.recipients.length, 2);
  assert.ok(delivery.recipients[0]?.txHash?.startsWith("0x"));
  assert.equal(delivery.recipients[0]!.amount, "300000");
  ok("executePayrollSettlement disburses each leg (mock) with txHashes");
}

function testEnsJourneyGuide(): void {
  const ensDelivery = {
    org: "verifytest.base.eth",
    orgLabel: "verifytest",
    names: [
      {
        org: "verifytest.base.eth",
        orgLabel: "verifytest",
        subname: "wallet-a",
        ens: "wallet-a.verifytest.base.eth",
        address: ADDR_A,
        created: true,
        txHashes: ["0xabc"],
      },
      {
        org: "verifytest.base.eth",
        orgLabel: "verifytest",
        subname: "wallet-b",
        ens: "wallet-b.verifytest.base.eth",
        address: ADDR_B,
        created: true,
        txHashes: ["0xdef"],
      },
    ],
  };

  const enriched = attachEnsJourneyGuide(ensDelivery, "1000000");
  assert.equal(enriched.journeyGuide.step, 1);
  assert.equal(enriched.journeyGuide.nextStep.service, "USDC Split Policy");
  assert.ok(enriched.journeyGuide.nextStep.requirements.recipients);
  ok("ENS delivery includes journeyGuide.nextStep for policy");

  const policyReq = buildPolicyRequirementsFromEns(ensDelivery, {
    totalUsdc: "1000000",
    bps: [3000, 6000],
  });
  const recipients = policyReq.recipients as Array<{ bps: number; subname: string }>;
  assert.equal(recipients.length, 2);
  assert.equal(recipients[0]!.bps, 3000);
  assert.equal(recipients[1]!.subname, "wallet-b");
  ok("buildPolicyRequirementsFromEns maps ENS names → policy recipients");
}

async function testNlJsonUnwrap(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.log("  ⊘ NL JSON unwrap (skipped — no AI key in env)");
    return;
  }

  const delivery = await interpretPolicyFromRequirements(
    JSON.stringify({
      text: `split 30% to ${ADDR_A} and 60% to ${ADDR_B}`,
      totalUsdc: "500000",
    }),
  );

  assert.equal(delivery.allocatedBps, 9000);
  assert.equal(delivery.executionGuide?.totalUsdc, "500000");
  ok("NL { text } JSON routes to LLM and respects totalUsdc");
}

async function testEnsResolveParsing(): Promise<void> {
  const queries = await parseEnsResolveQueries(
    JSON.stringify({
      queries: [
        { name: "blockdevre.base.eth" },
        { name: "vitalik.eth" },
        { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      ],
    }),
  );

  assert.equal(queries.length, 3);
  assert.equal(queries[0]?.direction, "forward");
  assert.equal(queries[2]?.direction, "reverse");
  ok("ENS resolver parses queries array from requirements");

  const fromText = await parseEnsResolveQueries(
    JSON.stringify({ text: ENS_NAME }),
  );
  assert.equal(fromText.length, 1);
  assert.equal(fromText[0]?.direction, "forward");
  assert.equal(fromText[0]?.value, ENS_NAME);
  ok("ENS resolver accepts { text: \"name.base.eth\" }");

  const fromAddress = await parseEnsResolveQueries(
    JSON.stringify({ text: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }),
  );
  assert.equal(fromAddress[0]?.direction, "reverse");
  ok("ENS resolver accepts { text: \"0x...\" } for reverse lookup");

  const plain = await parseEnsResolveQueries("vitalik.eth");
  assert.equal(plain[0]?.direction, "forward");
  ok("ENS resolver accepts plain text name");
}

async function testInstantUsdcPayParsing(): Promise<void> {
  const { parseInstantUsdcPayRequirements } = await import(
    "../src/policy/instant-usdc-pay.js"
  );

  const fromJson = await parseInstantUsdcPayRequirements(
    JSON.stringify({
      to: ADDR_A,
      amount: "50000",
    }),
  );
  assert.equal(fromJson.to, ADDR_A);
  assert.equal(fromJson.amount, "50000");
  ok("instant USDC pay parses JSON to + amount");

  const fromNl = await parseInstantUsdcPayRequirements(
    `Send 0.05 USDC to ${ADDR_A}`,
  );
  assert.equal(fromNl.amount, "50000");
  ok("instant USDC pay parses natural language send X USDC to Y");

  const fundFallback = await parseInstantUsdcPayRequirements(
    JSON.stringify({ to: ADDR_A }),
    { fundAmount: "75000" },
  );
  assert.equal(fundFallback.amount, "75000");
  ok("instant USDC pay uses fundAmount when amount omitted");

  const storeUi = await parseInstantUsdcPayRequirements(ENS_NAME, {
    fundAmount: "10000",
  });
  assert.equal(storeUi.to, ENS_NAME);
  assert.equal(storeUi.amount, "10000");
  ok("instant USDC pay accepts recipient-only text when Store UI sets principal");

  const storeAddress = await parseInstantUsdcPayRequirements(
    JSON.stringify({ address: ADDR_A }),
    { fundAmount: "100000" },
  );
  assert.equal(storeAddress.to, ADDR_A);
  assert.equal(storeAddress.amount, "100000");
  ok("instant USDC pay parses Agent Store { address } + checkout principal");

  const storeSend = await parseInstantUsdcPayRequirements(
    JSON.stringify({ send: ENS_NAME, principal_amount: 0.01 }),
  );
  assert.equal(storeSend.to, ENS_NAME);
  assert.equal(storeSend.amount, "10000");
  ok("instant USDC pay parses Agent Store { send, principal_amount }");

  const { resolveInstantPayFundAddress } = await import(
    "../src/policy/instant-usdc-pay.js"
  );
  const fundAddr = await resolveInstantPayFundAddress(
    JSON.stringify({ address: ADDR_A }),
  );
  assert.equal(
    fundAddr.toLowerCase(),
    ADDR_A.toLowerCase(),
  );
  ok("instant USDC pay accept resolves fund address from address-only schema");
}

async function testInstantUsdcPayCapSettlement(): Promise<void> {
  const { buildDirectCapInstantPayDelivery } = await import(
    "../src/chain/instant-pay-settlement.js"
  );

  const recipient = ADDR_A;
  const resolved = {
    to: recipient,
    amount: "100000",
    address: recipient,
  };

  const capOrder = {
    payTxHash: "0xabc123",
    providerFundAddress: recipient,
    fundAmount: "100000",
  } as import("@croo-network/sdk").Order;

  const delivery = buildDirectCapInstantPayDelivery(capOrder, resolved);
  assert.equal(delivery.settlement, "direct_cap");
  assert.equal(delivery.amount, "100000");
  assert.equal(delivery.txHash, "0xabc123");
  ok("instant USDC pay builds direct_cap delivery when CAP funds recipient");

  const noFundOrder = {
    payTxHash: "0xabc123",
    fundAmount: "0",
  } as import("@croo-network/sdk").Order;

  assert.throws(
    () => buildDirectCapInstantPayDelivery(noFundOrder, resolved),
    /requires CROO fund transfer/,
  );
  ok("instant USDC pay rejects orders without CAP fund transfer (no wallet fallback)");

  const { loadPolicyWithFallback } = await import("../src/policy/store.js");
  const missing = await loadPolicyWithFallback("pol_deadbeef0000");
  assert.equal(missing, null);
  ok("loadPolicyWithFallback returns null when policy absent everywhere");

  const { loadPolicyFromCompletedOrders } = await import("../src/policy/policy-lookup.js");
  const { policyIdMatches } = await import("../src/policy/policy-id.js");
  assert.equal(policyIdMatches("pol_3838ea774da", "pol_3838ea774dad"), true);
  ok("policyIdMatches tolerates truncated policyId");
}

async function testOrderStateGuards(): Promise<void> {
  const { OrderStatus } = await import("@croo-network/sdk");
  const { shouldProcessOrderPaid } = await import("../src/cap/order-state.js");

  assert.equal(shouldProcessOrderPaid(OrderStatus.Paid).proceed, true);
  assert.equal(shouldProcessOrderPaid(OrderStatus.DeliverFailed).proceed, true);
  assert.equal(shouldProcessOrderPaid(OrderStatus.Completed).proceed, false);
  assert.equal(shouldProcessOrderPaid(OrderStatus.Delivering).proceed, false);
  assert.equal(shouldProcessOrderPaid(OrderStatus.Created).proceed, false);
  ok("shouldProcessOrderPaid matches CROO OrderStatus");
}

async function testOrderLedger(): Promise<void> {
  const {
    claimOrderProcessing,
    clearMemoryLedgerForTests,
    getStagedDelivery,
    isFulfillmentReadyForDelivery,
    saveOrderFulfillment,
    loadOrderFulfillment,
    stageOrderDelivery,
    LEDGER_PHASE_FULFILLED,
  } = await import("../src/cap/order-ledger.js");

  clearMemoryLedgerForTests();

  const orderId = `test-order-${Date.now()}`;
  const claimed = await claimOrderProcessing(orderId, "svc-test", { policyId: "pol_test" });
  assert.equal(claimed, true);

  const processing = await loadOrderFulfillment(orderId);
  assert.ok(processing);
  assert.equal(isFulfillmentReadyForDelivery(processing!.deliveryPayload), false);

  const claimedAgain = await claimOrderProcessing(orderId, "svc-test");
  assert.equal(claimedAgain, false);

  await stageOrderDelivery(orderId, "svc-test", {
    policyId: "pol_test",
    policy: { recipients: [{ address: "0x0", label: "a", bps: 10000 }] },
  });
  const stagedRow = await loadOrderFulfillment(orderId);
  assert.ok(getStagedDelivery(stagedRow!.deliveryPayload));
  assert.equal(isFulfillmentReadyForDelivery(stagedRow!.deliveryPayload), true);

  await saveOrderFulfillment(orderId, "svc-test", {
    policyId: "pol_test",
    recipients: [{ label: "a", address: "0x0", amount: "1", txHash: "0x1" }],
  });

  const fulfilled = await loadOrderFulfillment(orderId);
  assert.ok(fulfilled);
  assert.equal(fulfilled!.deliveryPayload._ledgerPhase, LEDGER_PHASE_FULFILLED);
  assert.equal(isFulfillmentReadyForDelivery(fulfilled!.deliveryPayload), true);
  ok("order ledger claim + stage + fulfilled delivery detection");

  clearMemoryLedgerForTests();
}

async function testAssertLedgerReadyForFundOrders(): Promise<void> {
  const {
    assertLedgerReadyForFundOrders,
    isDatabaseReadyForLedger,
  } = await import("../src/cap/order-ledger.js");

  if (isDatabaseReadyForLedger()) {
    assertLedgerReadyForFundOrders();
    ok("assertLedgerReadyForFundOrders passes when Postgres ledger ready");
    return;
  }

  assert.throws(
    () => assertLedgerReadyForFundOrders(),
    /DATABASE_URL is required/,
  );
  ok("assertLedgerReadyForFundOrders rejects without Postgres");
}

async function main(): Promise<void> {
  console.log("\nRemifi flow verification\n");

  await initPolicyDatabase();

  const policyId = await testPolicyCreationAndStore();
  await testExecutePayrollPlan(policyId);
  await testPayrollDisbursement(policyId);
  testEnsJourneyGuide();
  testEnsResolveParsing();
  await testInstantUsdcPayParsing();
  await testInstantUsdcPayCapSettlement();
  await testNlJsonUnwrap();
  await testOrderStateGuards();
  await testOrderLedger();
  await testAssertLedgerReadyForFundOrders();

  console.log(`\n${passed} checks passed.\n`);
}

main().catch((err) => {
  console.error("\nFAILED:", err.message ?? err);
  process.exit(1);
});
