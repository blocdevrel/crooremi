# A2A Composability — Remifi

Remifi is built as a **composable payout leg**: other agents hire it over CAP, receive Schema JSON deliveries, and chain services without a shared database.

**Agent Store:** [fd57334e-5e6f-4b76-9d5f-da0202f23a10](https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10)

CROO judges receive **aggregated CAP order data**. Mirror your proof anytime:

```bash
npm run export:orders
```

Writes `docs/ORDERS.json` with relationship counts, service depth, and per-requester chains.

---

## What judges score (25% — A2A composability)

| Dimension | What they look for | Remifi proof |
|-----------|-------------------|--------------|
| **Number** | Distinct agents hiring you; order volume | `totals.uniqueRequesterAgents`, `totals.completedOrders` |
| **Delivery** | Orders complete with real CAP delivery | `totals.deliverySuccessRate`, `payTxHash` + `deliverTxHash` per order |
| **Depth** | Multi-step chains, fund transfers, service breadth | `requesterRelationships`, `serviceCoverage`, `payrollChains` |

---

## Integration patterns

### 1. Single agent — payroll chain (most common)

```
createPolicy  →  policyId + executionGuide.payroll
executePaymentJob  →  fundAmount USDC  →  per-recipient txHashes
```

Policy lookup is scoped to **your** `requesterAgentId` CAP history. See [REQUESTER.md](./REQUESTER.md).

### 2. Cross-agent — policy portable by ID (deepest composability)

```
Agent A  →  createPolicy  →  policyId
Agent B  →  executePaymentJob({ policyId, totalUsdc })  →  on-chain split
```

Agent B does **not** need Agent A's order history. Policies persist in Postgres by `policyId`.

```bash
# Requires two different CROO SDK keys
npm run a2a:cross-agent
```

Env: `CROO_POLICY_AGENT_SDK_KEY`, `CROO_EXECUTOR_AGENT_SDK_KEY`

### 3. One-shot payout

```
instantUsdcPay  →  CAP sends USDC directly to recipient  →  delivery proof
```

### 4. Identity + policy + pay (full stack)

```bash
npm run journey   # ENS → createPolicy → executePaymentJob
```

---

## Grow your A2A score

| Action | Command | Target |
|--------|---------|--------|
| Add a 3rd hiring agent | Register agent on dashboard → `npm run a2a:hire` | `uniqueRequesterAgents ≥ 3` |
| Prove cross-agent depth | `npm run a2a:cross-agent` | 2 agents, 1 policy, 1 execution |
| Refresh judge proof | `npm run export:orders` | `docs/ORDERS.json` |
| Disclose test agents | README § A2A test agents | Honesty on self-trade |

### Third-agent hire

```bash
# .env
CROO_THIRD_AGENT_SDK_KEY=croo_sk_...   # new dashboard agent

npm run a2a:hire
# or: A2A_HIRE_SERVICE=resolveEns npm run a2a:hire
# or: A2A_HIRE_SERVICE=instantPay npm run a2a:hire
```

---

## Disclosed test agents

Remifi team runs integration tests with **disclosed CROO test agents** (not external partners unless noted in demo):

| Role | Env var | Purpose |
|------|---------|---------|
| Primary requester | `CROO_REQUESTER_SDK_KEY` | Journey scripts, policy + execute |
| Secondary requester | second SDK key in dashboard | Additional hire diversity |
| Policy agent (cross-A2A) | `CROO_POLICY_AGENT_SDK_KEY` | Defines splits |
| Executor agent (cross-A2A) | `CROO_EXECUTOR_AGENT_SDK_KEY` | Executes another agent's policyId |

State plainly in your demo if agents are yours: *"These are Remifi integration test agents."*

---

## Delivery JSON = composability contract

Every hire returns machine-readable Schema JSON:

| Service | Key fields for downstream agents |
|---------|----------------------------------|
| `createPolicy` | `policyId`, `policy`, `executionGuide.payroll` |
| `executePaymentJob` | `recipients[].txHash`, `fundTxHash`, `settlement` |
| `createEnsName` | `ens`, `journeyGuide.nextStep` |
| `instantUsdcPay` | `to`, `fundTxHash`, `settlement: direct_cap` |

Hiring agents parse `getDelivery()` — no Remifi SDK required on the requester side, only `@croo-network/sdk`.

---

## Links

- [REQUESTER.md](./REQUESTER.md) — copy-paste hire guide
- [CAP_INTEGRATION.md](./CAP_INTEGRATION.md) — full SDK reference
- [OUTREACH.md](./OUTREACH.md) — partner agent outreach templates
