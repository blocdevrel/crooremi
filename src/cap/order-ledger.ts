import {
  getOrderLedgerPool,
  isDatabaseReady,
  isOrderLedgerReady,
  tryAcquireOrderAdvisoryLock,
  releaseOrderAdvisoryLock,
} from "../policy/database.js";

export {
  tryAcquireOrderAdvisoryLock,
  releaseOrderAdvisoryLock,
};

export const LEDGER_PHASE_PROCESSING = "processing" as const;
export const LEDGER_PHASE_FULFILLED = "fulfilled" as const;

export type LedgerPhase =
  | typeof LEDGER_PHASE_PROCESSING
  | typeof LEDGER_PHASE_FULFILLED;

export type OrderFulfillmentRecord = {
  orderId: string;
  serviceId: string;
  deliveryPayload: Record<string, unknown>;
  createdAt: string;
};

const memoryLedger = new Map<string, OrderFulfillmentRecord>();

export function ledgerPhase(
  payload: Record<string, unknown>,
): LedgerPhase | undefined {
  const phase = payload._ledgerPhase;
  return phase === LEDGER_PHASE_PROCESSING || phase === LEDGER_PHASE_FULFILLED
    ? phase
    : undefined;
}

export function getStagedDelivery(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const staged = payload.stagedDelivery;
  if (staged && typeof staged === "object" && !Array.isArray(staged)) {
    return staged as Record<string, unknown>;
  }
  return null;
}

export function assertLedgerReadyForFundOrders(): void {
  if (!isOrderLedgerReady()) {
    throw new Error(
      "DATABASE_URL is required for executePaymentJob and instantUsdcPay — " +
        "order fulfillment ledger prevents double-disburse on retry",
    );
  }
}

export function isFulfillmentReadyForDelivery(
  payload: Record<string, unknown>,
): boolean {
  if (ledgerPhase(payload) === LEDGER_PHASE_FULFILLED) {
    return true;
  }
  const staged = getStagedDelivery(payload);
  if (staged && isDeliveryPayloadComplete(staged)) {
    return true;
  }
  if (payload.success === false) {
    return false;
  }
  return isDeliveryPayloadComplete(payload);
}

function isDeliveryPayloadComplete(payload: Record<string, unknown>): boolean {
  if (Array.isArray(payload.recipients) && payload.recipients.length > 0) {
    return true;
  }
  if (typeof payload.policyId === "string" && payload.policy) {
    return true;
  }
  if (payload.settlement === "direct_cap" && payload.fundTxHash) {
    return true;
  }
  if (Array.isArray(payload.results)) {
    return true;
  }
  if (typeof payload.ens === "string" || Array.isArray(payload.names)) {
    return true;
  }
  return false;
}

export async function loadOrderFulfillment(
  orderId: string,
): Promise<OrderFulfillmentRecord | null> {
  const cached = memoryLedger.get(orderId);
  if (cached) {
    return cached;
  }

  if (!isOrderLedgerReady()) {
    return null;
  }

  const pool = getOrderLedgerPool();
  if (!pool) {
    return null;
  }

  const result = await pool.query<{
    order_id: string;
    service_id: string;
    delivery_payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT order_id, service_id, delivery_payload, created_at
     FROM remifi_order_fulfillments
     WHERE order_id = $1`,
    [orderId],
  );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0]!;
  const record: OrderFulfillmentRecord = {
    orderId: row.order_id,
    serviceId: row.service_id,
    deliveryPayload: row.delivery_payload,
    createdAt: row.created_at.toISOString(),
  };
  memoryLedger.set(orderId, record);
  return record;
}

async function persistLedger(record: OrderFulfillmentRecord): Promise<void> {
  memoryLedger.set(record.orderId, record);

  if (!isOrderLedgerReady()) {
    return;
  }

  const pool = getOrderLedgerPool();
  if (!pool) {
    return;
  }

  await pool.query(
    `INSERT INTO remifi_order_fulfillments (order_id, service_id, delivery_payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (order_id) DO UPDATE
     SET delivery_payload = EXCLUDED.delivery_payload,
         service_id = EXCLUDED.service_id`,
    [
      record.orderId,
      record.serviceId,
      JSON.stringify(record.deliveryPayload),
    ],
  );
}

export async function claimOrderProcessing(
  orderId: string,
  serviceId: string,
  processingMeta: Record<string, unknown> = {},
): Promise<boolean> {
  const existing = await loadOrderFulfillment(orderId);
  if (existing) {
    return false;
  }

  const payload = {
    ...processingMeta,
    _ledgerPhase: LEDGER_PHASE_PROCESSING,
    claimedAt: new Date().toISOString(),
  };

  if (isOrderLedgerReady()) {
    const pool = getOrderLedgerPool();
    if (pool) {
      const result = await pool.query<{ order_id: string }>(
        `INSERT INTO remifi_order_fulfillments (order_id, service_id, delivery_payload)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (order_id) DO NOTHING
         RETURNING order_id`,
        [orderId, serviceId, JSON.stringify(payload)],
      );
      if (!result.rowCount) {
        return false;
      }
    }
  }

  await persistLedger({
    orderId,
    serviceId,
    deliveryPayload: payload,
    createdAt: new Date().toISOString(),
  });
  return true;
}

export async function stageOrderDelivery(
  orderId: string,
  serviceId: string,
  stagedDelivery: Record<string, unknown>,
): Promise<void> {
  const current = await loadOrderFulfillment(orderId);
  await persistLedger({
    orderId,
    serviceId,
    deliveryPayload: {
      ...(current?.deliveryPayload ?? {}),
      _ledgerPhase: LEDGER_PHASE_PROCESSING,
      stagedDelivery,
      stagedAt: new Date().toISOString(),
    },
    createdAt: current?.createdAt ?? new Date().toISOString(),
  });
}

export async function saveOrderFulfillment(
  orderId: string,
  serviceId: string,
  deliveryPayload: Record<string, unknown>,
): Promise<void> {
  const payload = {
    ...deliveryPayload,
    _ledgerPhase: LEDGER_PHASE_FULFILLED,
  };
  await persistLedger({
    orderId,
    serviceId,
    deliveryPayload: payload,
    createdAt: new Date().toISOString(),
  });
}

export async function appendWalletDisbursementLeg(
  orderId: string,
  serviceId: string,
  leg: { label: string; address: string; amount: string; txHash: string },
): Promise<void> {
  const current = await loadOrderFulfillment(orderId);
  const base = current?.deliveryPayload ?? {
    _ledgerPhase: LEDGER_PHASE_PROCESSING,
  };
  const walletRecipients = [
    ...((base.walletRecipients as typeof leg[] | undefined) ?? []),
    leg,
  ];
  await persistLedger({
    orderId,
    serviceId,
    deliveryPayload: {
      ...base,
      _ledgerPhase: LEDGER_PHASE_PROCESSING,
      walletRecipients,
    },
    createdAt: current?.createdAt ?? new Date().toISOString(),
  });
}

export async function saveRouterSplitResult(
  orderId: string,
  serviceId: string,
  splitTxHash: string,
  recipients: Array<{
    label: string;
    address: string;
    amount: string;
    txHash: string;
  }>,
): Promise<void> {
  const current = await loadOrderFulfillment(orderId);
  await persistLedger({
    orderId,
    serviceId,
    deliveryPayload: {
      ...(current?.deliveryPayload ?? {}),
      _ledgerPhase: LEDGER_PHASE_PROCESSING,
      routerSplitTxHash: splitTxHash,
      routerRecipients: recipients,
    },
    createdAt: current?.createdAt ?? new Date().toISOString(),
  });
}

export function walletRecipientsFromLedger(
  payload: Record<string, unknown>,
): Array<{ label: string; address: string; amount: string; txHash: string }> {
  const rows = payload.walletRecipients ?? payload.routerRecipients;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter(
    (row): row is { label: string; address: string; amount: string; txHash: string } =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as { txHash?: string }).txHash === "string",
  );
}

export function routerSplitTxFromLedger(
  payload: Record<string, unknown>,
): string | null {
  const hash = payload.routerSplitTxHash;
  return typeof hash === "string" && hash.startsWith("0x") ? hash : null;
}

export function clearMemoryLedgerForTests(): void {
  memoryLedger.clear();
}

export function isDatabaseReadyForLedger(): boolean {
  return isDatabaseReady();
}
