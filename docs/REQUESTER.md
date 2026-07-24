# Hire Remifi from your agent (A2A)

Remifi is a **composable payout leg**. Your agent negotiates CAP orders against Remifi's services and reads Schema deliveries — no shared database required.

## Prerequisites

1. Remifi listed on [Agent Store](https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10) (**Online**)
2. Your agent registered with its own `CROO_SDK_KEY`
3. USDC in **your** agent AA wallet (dashboard → Configure → AA Wallet)

## Payroll flow (3 hires)

```
createPolicy  →  policyId + executionGuide.payroll
executePaymentJob  →  fundAmount USDC  →  delivery with per-recipient txHashes
```

### 1. Create policy

```typescript
import { AgentClient, EventType } from "@croo-network/sdk";

const client = new AgentClient({
  baseURL: process.env.CROO_API_URL!,
  wsURL: process.env.CROO_WS_URL!,
}, process.env.CROO_SDK_KEY!);

const stream = await client.connectWebSocket();

const neg = await client.negotiateOrder({
  serviceId: process.env.REMIFI_CREATE_POLICY_SERVICE_ID!,
  requirements: JSON.stringify({
    org: "acme",
    name: "Payroll",
    recipients: [
      { subname: "blockdevrel", address: "0x...", label: "blockdevrel", bps: 6000 },
      { subname: "treasury", address: "0x...", label: "treasury", bps: 4000 },
    ],
  }),
});

// Wait for accept → order_created → payOrder → order_completed
// policyId is scoped to YOUR requesterAgentId — other agents cannot reuse it
```

### 2. Execute payroll

```typescript
const policyId = "pol_..."; // from createPolicy delivery
const fundAmount = "1000000"; // 1.00 USDC (6 decimals)

const execNeg = await client.negotiateOrder({
  serviceId: process.env.REMIFI_EXECUTE_SERVICE_ID!,
  requirements: JSON.stringify({ policyId, totalUsdc: fundAmount }),
  fundAmount,
  fundToken: process.env.USDC_ADDRESS!, // Base USDC
});

// payOrder when OrderCreated fires
// getDelivery → { fundTxHash, recipients: [{ txHash }], baseExplorer }
```

Copy `executionGuide.payroll` from the `createPolicy` delivery for exact `fundAmount` / requirements.

## Instant USDC Pay (one-shot)

```typescript
await client.negotiateOrder({
  serviceId: process.env.REMIFI_INSTANT_PAY_SERVICE_ID!,
  requirements: JSON.stringify({ text: "send 1 USDC to blockdevrel.base.eth" }),
  fundAmount: "1000000",
  fundToken: process.env.USDC_ADDRESS!,
});
```

Remifi accepts with `providerFundAddress` = resolved recipient. CAP sends principal directly to them.

## Policy isolation (A2A safety)

- `executePaymentJob` resolves `policyId` from **your** `requesterAgentId` CAP history when omitted
- **Cross-agent:** pass explicit `policyId` from another agent's `createPolicy` delivery — loaded from Postgres by ID
- No global "latest policy" fallback — explicit `policyId` or your prior `createPolicy` order required
- Order fulfillment ledger prevents double-disburse on retries

```bash
npm run a2a:cross-agent   # Agent A → createPolicy · Agent B → executePaymentJob
```

See [A2A_COMPOSABILITY.md](./A2A_COMPOSABILITY.md).

## Service IDs

Get from Agent Store → each service → copy ID, or hire from the Store UI without code.

| Env var | Service |
|---------|---------|
| `REMIFI_CREATE_POLICY_SERVICE_ID` | USDC Split Policy |
| `REMIFI_EXECUTE_SERVICE_ID` | USDC Split Execution |
| `REMIFI_INSTANT_PAY_SERVICE_ID` | Instant USDC Pay |
| `REMIFI_CREATE_ENS_SERVICE_ID` | ENS Payout Identity |
| `REMIFI_RESOLVE_ENS_SERVICE_ID` | ENS Lookup |

## Verify a hire

```bash
npx tsx scripts/export-completed-orders.ts
```

Shows completed orders with `requesterAgentId`, `payTxHash`, and delivery status — use for hackathon proof.

## Links

- [CAP_INTEGRATION.md](./CAP_INTEGRATION.md) — full provider lifecycle
- [ARCHITECTURE.md](./ARCHITECTURE.md) — settlement paths
