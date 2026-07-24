# Remifi Architecture

## Overview

Remifi sits between **CROO CAP** (commerce / hiring) and **Base** (USDC settlement + Base Names).

```
Hiring agent                    Remifi provider                 Base
─────────────                   ───────────────                 ────
negotiateOrder ──CAP WS──────► acceptNegotiation(*)
payOrder ──────on-chain──────► OrderPaid
                               deliverOrder ────────────────► USDC split / ENS
getDelivery ◄──Schema JSON──── order_completed
```

## Components

| Path | Role |
|------|------|
| `src/cap/server.ts` | WebSocket provider, reconnect, event dispatch |
| `src/cap/handlers.ts` | Service routing, fund-transfer accept, delivery |
| `src/cap/order-state.ts` | CROO `OrderStatus` guards, per-order locks |
| `src/cap/order-ledger.ts` | Idempotent delivery replay (Postgres) |
| `src/policy/interpreter.ts` | JSON / NL → split policy |
| `src/policy/execute-resolver.ts` | Execute requirements → batch plan |
| `src/policy/execute-batch.ts` | Policy + `totalUsdc` → payout legs |
| `src/chain/payroll-disbursement.ts` | Router or EOA USDC disbursement |
| `src/chain/instant-pay-settlement.ts` | CAP direct-to-recipient validation |
| `src/policy/database.ts` | Policies + order fulfillments |

## Settlement model

| Service | Who moves USDC |
|---------|----------------|
| `createPolicy` | None (schema only) |
| `createEnsName` | None (operator ETH for Base Names) |
| `resolveEnsName` | None (read-only) |
| `executePaymentJob` | CAP `payOrder` → **Router** (preferred) or payout EOA → recipients |
| `instantUsdcPay` | CAP `payOrder` → **recipient address** directly |

### Payroll path (executePaymentJob)

```
1. Provider acceptNegotiationWithFundAddress(ROUTER_ADDRESS)
2. Requester payOrder — batch sends fee + fundAmount USDC
3. Principal lands on Router (order.providerFundAddress, order.payTxHash)
4. Provider executeSplit(orderId) — one Base tx, all recipients
5. deliverOrder — Schema JSON with txHashes
```

Fallback without Router: `providerFundAddress` = payout EOA; viem `USDC.transfer` per leg.

### Instant pay path

```
1. Provider acceptNegotiationWithFundAddress(recipient 0x)
2. Requester payOrder — principal sent to recipient by CAP
3. Provider deliverOrder — proof only (settlement: direct_cap)
```

## CROO order states (SDK)

Remifi gates `OrderPaid` on:

| Status | Provider action |
|--------|-----------------|
| `paid` | Execute + deliver |
| `deliver_failed` | Retry deliver (ledger may have payload) |
| `delivering` | Skip (in flight) |
| `completed` | Skip (terminal) |
| `rejected` / `expired` | Skip (terminal) |

## Policy resolution (A2A)

Execute orders resolve `policyId` from:

1. Requirements JSON / LLM parse
2. Requester's completed `createPolicy` orders (`policy-lookup.ts`, paginated)
3. Postgres policy store (`DATABASE_URL`)

Global "latest policy" fallback removed — each requester's policy is isolated.

Requester guide: [REQUESTER.md](./REQUESTER.md) · Proof export: `npm run export:orders`

## Order fulfillment ledger

| Phase | When | Purpose |
|-------|------|---------|
| `processing` | After atomic claim | Work in progress; may include `stagedDelivery`, `walletRecipients`, or `routerRecipients` |
| `fulfilled` | After work completes | Idempotent `deliverOrder` replay |

**Cross-process safety:** Postgres `pg_try_advisory_lock(orderId)` wraps each `OrderPaid` handler.

**Schema services** (`createEns`, `createPolicy`, `resolveEns`): stage delivery JSON before any irreversible step, then `deliverOrder` without re-running work on retry.

**Fund services** (`executePaymentJob`, `instantUsdcPay`): refuse to run without `DATABASE_URL`. Wallet payroll persists each leg in `walletRecipients`. Router path persists `routerSplitTxHash` + `routerRecipients`; on `RouterSplitAlreadyExecutedError`, recovers from ledger or chain logs.

## Health

`GET /health` returns:

```json
{
  "ok": true,
  "provider": "online",
  "checks": {
    "database": "ok",
    "router": "configured",
    "payoutWallet": "ok",
    "crooApi": "ok",
    "capWebSocket": "online"
  }
}
```

## Phase 2 (post-hackathon)

- Recurring payment schedules
- Multi-chain settlement
