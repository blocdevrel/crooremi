import { createHash } from "node:crypto";
import pg from "pg";
import { env } from "../config.js";
import type { StoredPolicy } from "./types.js";

const { Pool } = pg;

let pool: pg.Pool | undefined;
let ready = false;

export function getOrderLedgerPool(): pg.Pool | undefined {
  return pool;
}

export function isOrderLedgerReady(): boolean {
  return ready;
}

export function isDatabaseEnabled(): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

export function isDatabaseReady(): boolean {
  return ready;
}

export async function initPolicyDatabase(): Promise<void> {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    console.log("[remifi] policy store: DATABASE_URL not set — using file/memory fallback");
    return;
  }

  pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS remifi_policies (
      policy_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS remifi_policies_created_at_idx
    ON remifi_policies (created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remifi_order_fulfillments (
      order_id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      delivery_payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  ready = true;
  console.log("[remifi] policy store: PostgreSQL ready");
}

export async function savePolicyToDatabase(delivery: StoredPolicy): Promise<void> {
  if (!ready || !pool) {
    return;
  }

  await pool.query(
    `INSERT INTO remifi_policies (policy_id, payload, created_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (policy_id) DO UPDATE
     SET payload = EXCLUDED.payload`,
    [delivery.policyId, JSON.stringify(delivery), delivery.createdAt],
  );
}

export async function loadPolicyFromDatabase(
  policyId: string,
): Promise<StoredPolicy | null> {
  if (!ready || !pool) {
    return null;
  }

  const target = policyId.trim().toLowerCase();

  const exact = await pool.query<{ payload: StoredPolicy }>(
    `SELECT payload FROM remifi_policies WHERE policy_id = $1`,
    [target],
  );
  if (exact.rowCount && exact.rowCount > 0) {
    return exact.rows[0]!.payload;
  }

  const prefix = await pool.query<{ payload: StoredPolicy }>(
    `SELECT payload FROM remifi_policies
     WHERE policy_id = $1 OR policy_id LIKE $1 || '%'
     ORDER BY length(policy_id) ASC
     LIMIT 2`,
    [target],
  );
  if (prefix.rowCount === 1) {
    return prefix.rows[0]!.payload;
  }

  return null;
}

export async function closePolicyDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
  ready = false;
}

function advisoryLockKey(orderId: string): bigint {
  const digest = createHash("sha256").update(orderId).digest();
  return digest.readBigInt64BE(0);
}

export async function tryAcquireOrderAdvisoryLock(orderId: string): Promise<boolean> {
  if (!ready || !pool) {
    return true;
  }
  const result = await pool.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1::bigint) AS locked",
    [advisoryLockKey(orderId).toString()],
  );
  return Boolean(result.rows[0]?.locked);
}

export async function releaseOrderAdvisoryLock(orderId: string): Promise<void> {
  if (!ready || !pool) {
    return;
  }
  await pool.query("SELECT pg_advisory_unlock($1::bigint)", [
    advisoryLockKey(orderId).toString(),
  ]);
}
