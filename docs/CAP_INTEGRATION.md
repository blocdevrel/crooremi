# CAP Integration

Remifi is a **CAP provider** using [@croo-network/sdk](https://docs.croo.network) v0.2.1.

Official SDK reference: `node_modules/@croo-network/sdk/README.md` and [CROO docs](https://docs.croo.network).

---

## Setup

### 1. Register agent

1. Go to [agent.croo.network](https://agent.croo.network) → **Register Agent**
2. Copy `CROO_SDK_KEY` (shown once)
3. Create **five services** (see table below) and copy each service ID into `.env`
4. Deposit USDC to the **requester AA wallet** before hiring (SDK checks balance on `payOrder`)

### 2. Environment

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `CROO_API_URL` | yes | `https://api.croo.network` |
| `CROO_WS_URL` | yes | `wss://api.croo.network/ws` — provider must stay connected for **Online** |
| `CROO_SDK_KEY` | yes | Provider SDK key (`croo_sk_...`) |
| `CROO_SERVICE_ID_CREATE_ENS` | yes | ENS Payout Identity |
| `CROO_SERVICE_ID_CREATE_POLICY` | yes | USDC Split Policy |
| `CROO_SERVICE_ID_EXECUTE_PAYMENT` | yes | USDC Split Execution |
| `CROO_SERVICE_ID_RESOLVE_ENS` | yes | ENS Lookup |
| `CROO_SERVICE_ID_INSTANT_USDC_PAY` | yes | Instant USDC Pay |
| `DATABASE_URL` | prod (fund) | **Required** for `executePaymentJob` and `instantUsdcPay` — order fulfillment ledger |
| `BASE_RPC_URL` | yes | Base mainnet RPC |
| `USDC_ADDRESS` | yes | Base USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| `ROUTER_ADDRESS` | recommended | Fund-transfer accept address for payroll |
| `ROUTER_EXECUTOR_ADDRESS` | with router | Must match on-chain router executor |
| `PROVIDER_PAYOUT_PRIVATE_KEY` | recommended | Signs `router.executeSplit` or EOA transfers |
| `ENS_REGISTRAR_PRIVATE_KEY` | yes (ENS) | Operator wallet for Base Names gas |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | prod | LangChain parsing |

### 3. Run provider

```bash
npm install
npm run dev
```

Health: `GET http://localhost:3001/health` — returns CAP, DB, router, and payout wallet checks.

---

## CROO order lifecycle (official)

Per `@croo-network/sdk` `OrderStatus`:

```
creating → created → paying → paid → delivering → completed
                              ↘ pay_failed
                    ↘ deliver_failed (retry delivery)
         ↘ rejected / expired
```

**Provider responsibilities:**

| Event | Action |
|-------|--------|
| `NegotiationCreated` | `getNegotiation` → `acceptNegotiation` or `acceptNegotiationWithFundAddress` |
| `OrderPaid` | Execute work → `deliverOrder` (Schema JSON) |
| `OrderCompleted` | Log / done |

**Requester responsibilities:**

| Event | Action |
|-------|--------|
| `OrderCreated` | `payOrder` (USDC from AA wallet) |
| `OrderCompleted` | `getDelivery` |

Remifi implements idempotent `OrderPaid` handling in `src/cap/order-state.ts`, `src/cap/order-ledger.ts`, and `src/cap/handlers.ts`:

| Layer | Mechanism |
|-------|-----------|
| CROO status | Skips terminal statuses; retries `paid` and `deliver_failed` |
| In-process lock | `withOrderLock` / `withNegotiationLock` — WS redelivery on one worker |
| Postgres advisory lock | `pg_try_advisory_lock` per `orderId` — cross-replica mutex on Railway |
| Order ledger | `claimOrderProcessing` — atomic INSERT … ON CONFLICT DO NOTHING |
| Staged delivery | `stageOrderDelivery` before `deliverOrder` — schema services never re-run ENS/policy on retry |
| Fund services | `assertLedgerReadyForFundOrders` — refuses execute/instant pay without `DATABASE_URL` |
| Router recovery | `saveRouterSplitResult` + `recoverRouterSplitFromChain` — split succeeded on-chain but ledger crashed |
| Wallet payroll | `appendWalletDisbursementLeg` — resume mid-disburse without double-pay |

---

## SDK methods used

### Provider (`src/cap/`)

| Method | When |
|--------|------|
| `connectWebSocket()` | Stay Online; receive events |
| `getNegotiation()` | Read requirements |
| `acceptNegotiation()` | Non-fund services (ENS, policy, resolve) |
| `acceptNegotiationWithFundAddress()` | Fund-transfer services — declares `providerFundAddress` |
| `rejectNegotiation()` | Invalid requirements |
| `getOrder()` | Load order on `OrderPaid`; verify `payTxHash`, `fundAmount`, `providerFundAddress` |
| `deliverOrder()` | Submit Schema delivery |
| `listOrders()` / `getDelivery()` | Policy recovery from past `createPolicy` orders |

### Requester (scripts / hiring agents)

| Method | When |
|--------|------|
| `negotiateOrder()` | Hire service; pass `fundAmount` + `fundToken` for fund-transfer services |
| `payOrder()` | Pay service fee + principal |
| `getDelivery()` | Read result JSON + tx hashes |

### WebSocket events

`NegotiationCreated` · `OrderCreated` · `OrderPaid` · `OrderCompleted` · `OrderRejected` · `OrderExpired`

---

## Services (Agent Store)

| Service | Fund transfer | Accept method | Settlement |
|---------|---------------|---------------|------------|
| `createEnsName` | OFF | `acceptNegotiation` | Operator ETH for Base Names |
| `createPolicy` | OFF | `acceptNegotiation` | Schema only |
| `resolveEnsName` | OFF | `acceptNegotiation` | Read-only lookup |
| `executePaymentJob` | **ON** | `acceptNegotiationWithFundAddress(ROUTER or payout EOA)` | CAP → Router/EOA → on-chain split |
| `instantUsdcPay` | **ON** | `acceptNegotiationWithFundAddress(recipient)` | CAP → recipient directly |

### Fund-transfer fields (SDK `Order` / `Negotiation`)

When `require_fund_transfer=true` on a service:

- `fundAmount` — principal in USDC base units (6 decimals)
- `fundToken` — USDC contract address
- `providerFundAddress` — set by provider at accept; requester `payOrder` batch sends principal here
- `payTxHash` — on-chain proof buyer paid (required before delivery)
- `feeAmount` — service fee in escrow (separate from principal)

---

## executePaymentJob

### Requirements (Schema)

```json
{
  "policyId": "pol_abc123",
  "totalUsdc": "1000000"
}
```

Requester must pass matching `fundAmount` + `fundToken` on `negotiateOrder`.

### Provider flow

```
1. acceptNegotiationWithFundAddress(negotiationId, ROUTER_ADDRESS)
2. Requester payOrder → USDC to Router (order.payTxHash)
3. OrderPaid → router.executeSplit → each recipient
4. deliverOrder → { fundTxHash, recipients[{ txHash }], settlement: "router_payroll" }
```

### Delivery example

```json
{
  "policyId": "pol_abc123",
  "totalUsdc": "1000000",
  "fundTxHash": "0x...",
  "splitTxHash": "0x...",
  "txHashes": ["0x...", "0x..."],
  "recipients": [
    { "label": "blockdevrel", "address": "0x...", "amount": "600000", "txHash": "0x..." },
    { "label": "treasury", "address": "0x...", "amount": "400000", "txHash": "0x..." }
  ],
  "baseExplorer": "https://basescan.org/tx/0x...",
  "settlement": "router_payroll"
}
```

Use `executionGuide.payroll` from `createPolicy` delivery for copy-paste execute requirements.

---

## instantUsdcPay

CAP sends principal **directly to the recipient** — `providerFundAddress` = recipient `0x` address.

```
negotiateOrder({ requirements, fundAmount, fundToken })
→ acceptNegotiationWithFundAddress(recipientAddress)
→ payOrder
→ deliverOrder { fundTxHash, settlement: "direct_cap" }
```

Agent Store **must** have **Require Fund Transfer ON**.

---

## createPolicy

Requirements: Text or Schema. Deliverable: Schema.

```json
{
  "org": "acme",
  "name": "Payroll split",
  "recipients": [
    { "subname": "blockdevrel", "address": "0x...", "label": "blockdevrel", "bps": 6000 },
    { "subname": "treasury", "address": "0x...", "label": "treasury", "bps": 4000 }
  ]
}
```

Or natural language when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set.

---

## Testing

```bash
npm run verify:flow     # offline unit flow
npm run verify:llm      # LangChain parsing
npm run journey         # full CAP journey (provider must be Online)
```

Requester env for journey scripts:

```bash
CROO_REQUESTER_SDK_KEY=croo_sk_...   # second agent SDK key
```

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Agent Offline | WebSocket not connected; check `CROO_WS_URL` and Railway deploy |
| Instant pay missing principal | Agent Store → Require Fund Transfer **ON** |
| Execute missing `payTxHash` | Requester must call `payOrder` before provider delivers |
| `provider_fund_address must be empty` | Used `acceptNegotiationWithFundAddress` on a non-fund service |
| Policy not found on execute | Hire `createPolicy` first; pass `policyId` explicitly |
| Double disburse on replay | Order ledger + advisory locks + staged delivery — see idempotency table above |
| Schema service double ENS/policy | Fixed — `stageOrderDelivery` before `savePolicy` / before CAP deliver |
| Router split succeeded, deliver crashed | Fixed — `recoverRouterSplitFromChain` reads `SplitExecuted` logs |

---

## Agent Store listing

Checklist: [AGENT_STORE.md](./AGENT_STORE.md)

## Hire Remifi (A2A requester)

Other agents integrate via CAP only — see [REQUESTER.md](./REQUESTER.md) and [A2A_COMPOSABILITY.md](./A2A_COMPOSABILITY.md).

Export completed orders for hackathon proof:

```bash
npm run export:orders
```

Writes `docs/ORDERS.json` with `requesterAgentId`, `payTxHash`, and delivery status per order.
