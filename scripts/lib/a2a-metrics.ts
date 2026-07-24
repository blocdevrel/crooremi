
export type OrderRow = {
  orderId: string;
  serviceId: string;
  serviceName: string;
  status: string;
  requesterAgentId?: string;
  requesterWallet?: string;
  fundAmount?: string;
  payTxHash?: string;
  deliverTxHash?: string;
  createdTime?: string;
  deliveryFetched?: string;
};

export type ServiceCoverage = {
  serviceName: string;
  serviceId: string;
  completedOrders: number;
  uniqueRequesters: number;
};

export type RequesterRelationship = {
  requesterAgentId: string;
  completedOrders: number;
  distinctServices: number;
  fundTransferOrders: number;
  services: Record<string, number>;
  payrollChains: number;
};

export type A2AComposabilityReport = {
  exportedAt: string;
  providerAgentId: string;
  remifiAgentStoreUrl: string;
  totals: {
    allOrders: number;
    completedOrders: number;
    completionRate: number;
    uniqueRequesterAgents: number;
    uniqueBuyerWallets: number;
    fundTransferOrders: number;
    totalFundUsdcBaseUnits: string;
    deliverySuccessRate: number;
  };
  serviceCoverage: ServiceCoverage[];
  requesterRelationships: RequesterRelationship[];
  composabilitySignals: {
    multiServiceRequesters: number;
    crossAgentPolicyPortable: boolean;
    allFiveServicesUsed: boolean;
    meetsAntiSybilAgentTarget: boolean;
    meetsTenPlusCompletedOrders: boolean;
  };
  orders: OrderRow[];
};

export function buildServiceNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  const pairs: Array<[string | undefined, string]> = [
    [process.env.CROO_SERVICE_ID_CREATE_POLICY, "createPolicy"],
    [process.env.CROO_SERVICE_ID_EXECUTE_PAYMENT, "executePaymentJob"],
    [process.env.CROO_SERVICE_ID_CREATE_ENS, "createEnsName"],
    [process.env.CROO_SERVICE_ID_RESOLVE_ENS, "resolveEnsName"],
    [process.env.CROO_SERVICE_ID_INSTANT_USDC_PAY, "instantUsdcPay"],
  ];
  for (const [id, name] of pairs) {
    if (id?.trim()) map.set(id.trim(), name);
  }
  return map;
}

function countPayrollChains(
  completed: OrderRow[],
  createPolicyId: string | undefined,
  executeId: string | undefined,
  requesterId: string,
): number {
  if (!createPolicyId || !executeId) return 0;

  const policies = completed
    .filter(
      (o) =>
        o.requesterAgentId === requesterId && o.serviceId === createPolicyId,
    )
    .map((o) => Date.parse(o.createdTime ?? "0"))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const executes = completed
    .filter(
      (o) =>
        o.requesterAgentId === requesterId && o.serviceId === executeId,
    )
    .map((o) => Date.parse(o.createdTime ?? "0"))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  let chains = 0;
  let execIdx = 0;
  for (const policyTime of policies) {
    while (execIdx < executes.length && executes[execIdx]! <= policyTime) {
      execIdx++;
    }
    if (execIdx < executes.length) {
      chains++;
      execIdx++;
    }
  }
  return chains;
}

export function buildA2AReport(
  allOrders: Array<{
    orderId: string;
    serviceId: string;
    status: string;
    requesterAgentId?: string;
    requesterWalletAddress?: string;
    fundAmount?: string;
    payTxHash?: string;
    deliverTxHash?: string;
    createdTime?: string;
  }>,
  completedRows: OrderRow[],
  providerAgentId: string,
  remifiAgentStoreUrl: string,
): A2AComposabilityReport {
  const serviceMap = buildServiceNameMap();
  const createPolicyId = process.env.CROO_SERVICE_ID_CREATE_POLICY?.trim();
  const executeId = process.env.CROO_SERVICE_ID_EXECUTE_PAYMENT?.trim();

  const uniqueRequesters = new Set(
    completedRows.map((r) => r.requesterAgentId).filter(Boolean),
  );
  const uniqueWallets = new Set(
    completedRows.map((r) => r.requesterWallet).filter((w) => w?.trim()),
  );

  const fundOrders = completedRows.filter(
    (o) => o.fundAmount && BigInt(o.fundAmount) > 0n,
  );
  const totalFund = fundOrders.reduce(
    (sum, o) => sum + BigInt(o.fundAmount!),
    0n,
  );

  const deliveryOk = completedRows.filter(
    (o) => o.deliveryFetched === "yes",
  ).length;

  const serviceCoverage: ServiceCoverage[] = [];
  for (const [serviceId, serviceLabel] of serviceMap) {
    const rows = completedRows.filter((o) => o.serviceId === serviceId);
    serviceCoverage.push({
      serviceName: serviceLabel,
      serviceId,
      completedOrders: rows.length,
      uniqueRequesters: new Set(rows.map((r) => r.requesterAgentId).filter(Boolean))
        .size,
    });
  }
  serviceCoverage.sort((a, b) => b.completedOrders - a.completedOrders);

  const requesterRelationships: RequesterRelationship[] = [];
  for (const requesterId of uniqueRequesters) {
    const rows = completedRows.filter((o) => o.requesterAgentId === requesterId);
    const services: Record<string, number> = {};
    for (const row of rows) {
      const name = row.serviceName;
      services[name] = (services[name] ?? 0) + 1;
    }
    requesterRelationships.push({
      requesterAgentId: requesterId,
      completedOrders: rows.length,
      distinctServices: Object.keys(services).length,
      fundTransferOrders: rows.filter(
        (o) => o.fundAmount && BigInt(o.fundAmount) > 0n,
      ).length,
      services,
      payrollChains: countPayrollChains(
        completedRows,
        createPolicyId,
        executeId,
        requesterId,
      ),
    });
  }
  requesterRelationships.sort((a, b) => b.completedOrders - a.completedOrders);

  const multiService = requesterRelationships.filter(
    (r) => r.distinctServices >= 2,
  ).length;

  const distinctServiceNames = new Set(
    completedRows.map((o) => o.serviceName),
  );

  return {
    exportedAt: new Date().toISOString(),
    providerAgentId,
    remifiAgentStoreUrl,
    totals: {
      allOrders: allOrders.length,
      completedOrders: completedRows.length,
      completionRate:
        allOrders.length > 0
          ? Math.round((completedRows.length / allOrders.length) * 1000) / 10
          : 0,
      uniqueRequesterAgents: uniqueRequesters.size,
      uniqueBuyerWallets: uniqueWallets.size,
      fundTransferOrders: fundOrders.length,
      totalFundUsdcBaseUnits: totalFund.toString(),
      deliverySuccessRate:
        completedRows.length > 0
          ? Math.round((deliveryOk / completedRows.length) * 1000) / 10
          : 0,
    },
    serviceCoverage,
    requesterRelationships,
    composabilitySignals: {
      multiServiceRequesters: multiService,
      crossAgentPolicyPortable: true,
      allFiveServicesUsed: distinctServiceNames.size >= 5,
      meetsAntiSybilAgentTarget: uniqueRequesters.size >= 3,
      meetsTenPlusCompletedOrders: completedRows.length >= 10,
    },
    orders: completedRows,
  };
}

export function printA2AScorecard(report: A2AComposabilityReport): void {
  const t = report.totals;
  const s = report.composabilitySignals;

  console.log("\n══ A2A Composability Scorecard ══\n");
  console.log(`Provider: ${report.providerAgentId}`);
  console.log(`Store:    ${report.remifiAgentStoreUrl}\n`);

  console.log("Number (relationships)");
  console.log(`  Unique hiring agents:     ${t.uniqueRequesterAgents}  ${s.meetsAntiSybilAgentTarget ? "✓ ≥3" : "✗ need ≥3"}`);
  console.log(`  Completed CAP orders:     ${t.completedOrders}  ${s.meetsTenPlusCompletedOrders ? "✓ ≥10" : "✗"}`);
  console.log(`  Completion rate:          ${t.completionRate}%`);

  console.log("\nDelivery");
  console.log(`  Delivery fetch success:   ${t.deliverySuccessRate}%`);
  console.log(`  Fund-transfer orders:     ${t.fundTransferOrders}`);
  console.log(
    `  Total principal moved:    ${t.totalFundUsdcBaseUnits} base units (~${(Number(t.totalFundUsdcBaseUnits) / 1e6).toFixed(2)} USDC)`,
  );

  console.log("\nDepth");
  console.log(`  Services with completions: ${report.serviceCoverage.filter((c) => c.completedOrders > 0).length}`);
  console.log(`  All 5 services used:       ${s.allFiveServicesUsed ? "✓" : "✗"}`);
  console.log(`  Multi-service requesters:  ${s.multiServiceRequesters}`);
  console.log(`  Policy portable by ID:     ${s.crossAgentPolicyPortable ? "✓ (Postgres + explicit policyId)" : "✗"}`);

  console.log("\nPer hiring agent:");
  for (const rel of report.requesterRelationships) {
    console.log(
      `  ${rel.requesterAgentId.slice(0, 8)}…  orders=${rel.completedOrders}  services=${rel.distinctServices}  payrollChains=${rel.payrollChains}`,
    );
  }
  console.log("");
}
