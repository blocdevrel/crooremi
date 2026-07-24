---
name: remifi-cap-integration
description: Integrates Remifi with CROO CAP SDK for agent registration, order lifecycle, and USDC settlement. Use when implementing cap/, Agent Store services, provider/requester flow, DeliverOrder, or debugging CAP WebSocket orders.
---

# Remifi CAP Integration

## Prerequisites

1. Account at [agent.croo.network](https://agent.croo.network)
2. Register agent → copy `CROO_SDK_KEY` (shown once)
3. Configure two services: `createPolicy`, `executePaymentJob`
4. Deposit USDC to **AA Wallet Address** (not Controller/Executor)

## Install

```bash
cd agent
npm install @croo-network/sdk viem
```

## Env

```bash
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_SDK_KEY=croo_sk_...
```

Gas for CAP orders is **sponsored by CROO** — developers do not need ETH for the order lifecycle.

## Order lifecycle (implement this)

```
NegotiateOrder → AcceptNegotiation → order_created (WS)
→ PayOrder (USDC → CAPVault escrow) → order_paid (WS)
→ DeliverOrder (your result) → order_completed (WS)
→ Requester GetDelivery
```

Provider must: listen WebSocket → accept → on `order_paid` → execute work → `DeliverOrder`.

## Remifi handler pattern

```typescript
// cap/handlers.ts — pseudocode
async function onOrderPaid(order) {
  const input = parseInput(order.requirements);
  if (order.serviceName === "createPolicy") {
    const policy = await interpretPolicy(input);
    await deliver(order, { policy });
  }
  if (order.serviceName === "executePaymentJob") {
    const policy = await resolvePolicy(input);
    const txHashes = await executeSplits(policy, input.amount);
    await deliver(order, { policyId: policy.id, txHashes });
  }
}
```

## Service registration (dashboard)

| Service | Price | Requirements | Deliverable |
|---------|-------|--------------|-------------|
| createPolicy | e.g. 0.10 USDC | Text or Schema | Schema |
| executePaymentJob | e.g. 1.00 USDC | Schema | Schema |

Use **Schema** deliverable so hiring agents get structured JSON (tx hashes, policy).

## Delivery payload examples

**createPolicy:**
```json
{
  "policyId": "pol_abc123",
  "policy": {
    "name": "Team revenue split",
    "recipients": [
      { "address": "0x...", "label": "team", "bps": 4000 },
      { "address": "0x...", "label": "treasury", "bps": 6000 }
    ]
  }
}
```

**executePaymentJob:**
```json
{
  "policyId": "pol_abc123",
  "totalUsdc": "1000000",
  "txHashes": ["0x...", "0x..."],
  "baseExplorer": "https://basescan.org/tx/0x..."
}
```

## Testing locally

1. Start provider: `agent/src/index.ts`
2. Register **second** agent as requester in dashboard
3. Fund requester AA wallet with test USDC
4. Set `CROO_TARGET_SERVICE_ID` to Remifi service ID
5. Run requester example or hire from Agent Store UI

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Funding wrong wallet | Use AA Wallet from Configure page |
| Agent stays Offline | WebSocket not connected; check `CROO_WS_URL` |
| Delivery rejected | Match deliverable Schema registered in dashboard |
| No on-chain proof | `executePaymentJob` must include real Base tx hashes |
| Fake A2A partners | Use real teams or disclose mock agents in README |

## SDK reference

- Quick start: [docs.croo.network/developer-docs/quick-start](https://docs.croo.network/developer-docs/quick-start.md)
- Order lifecycle: query docs with `?ask=order lifecycle states`
- Node package: `@croo-network/sdk`

## Document in repo

Update `docs/CAP_INTEGRATION.md` with: env vars, service IDs, SDK methods used, sample order JSON, test steps.
