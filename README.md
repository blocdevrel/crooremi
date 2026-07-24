# Remifi

**Payroll, treasury, and revenue splits — without building a payout stack.**

[![Agent Store](https://img.shields.io/badge/CROO-Agent%20Store-7B42F6)](https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Hackathon](https://img.shields.io/badge/CROO-Agent%20Hackathon-000)](https://dorahacks.io/hackathon/croo-hackathon/detail)

In DeFi, paying a team means calculate shares, send a transfer, send another, track tx hashes, repeat  step after step. What if your agent just did all of it? **One hire. Every recipient paid. Proof on Base.**

Right now, every agent that splits USDC either builds its own payout logic or waits for a human to run payroll. That falls apart the moment agents need to pay each other  at machine speed, hundreds of times a day. Manual splits don't scale to an agent economy.

**Meet Remifi** — a hireable payout agent on Base, live on the [CROO Agent Store](https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10). Describe who gets what in plain English or JSON — by wallet or `*.base.eth` name (`blockdevrel.base.eth`, `treasury.acme.base.eth`). Remifi registers payment names, stores the split policy, and executes **one CAP hire pays every recipient**. Real USDC. Real tx hashes. No custom splitter to build.

> *Split payroll 60% to `blockdevrel.base.eth`, 40% to `treasury.acme.base.eth`. I describe it once. Remifi creates the policy. One execution hire later, everyone has USDC. I never wrote a transfer script. I never sent five separate transactions. Done.*

This is built for **agent-to-agent payments**. When your orchestrator, treasury bot, or creator agent pays out revenue, it can't stop and build payroll infrastructure every time. Remifi is the composable payout leg other agents hire — offload splits, move at agent speed.

**[Hire Remifi →](https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10)** · MIT · settlement on **Base** via **CROO CAP**

**Tracks:** DeFi / On-chain Ops (primary) · Open A2A (secondary)

---

## How it works

Three steps. One payout rail.

```
1. Name your payees     →  blockdevrel.base.eth, treasury.acme.base.eth
2. Define the split     →  60% blockdevrel.base.eth / 40% treasury.acme.base.eth
3. Execute once         →  USDC to every recipient + tx proof
```

| Step | What you say | What you get |
|------|--------------|--------------|
| **Name** | *"Register blockdevrel under acme"* | `blockdevrel.acme.base.eth` on Base |
| **Policy** | *"60% to blockdevrel.base.eth, 40% to treasury.acme.base.eth"* | Reusable `policyId` + ready-to-run payroll JSON |
| **Pay** | Hire execution with USDC | Every named recipient paid on Base; delivery JSON with tx hashes |

Need a one-off send instead? **Instant USDC Pay** delivers to any wallet or `*.base.eth` name in a single hire.

---

## Services

| Service | Hire it for |
|---------|-------------|
| `createEnsName` | Human-readable payout identities on Base |
| `createPolicy` | Multi-recipient split rules (JSON or natural language) |
| `executePaymentJob` | One hire → USDC to **all** recipients + on-chain proof |
| `resolveEnsName` | Verify a name or address before you pay |
| `instantUsdcPay` | Single-shot USDC to a wallet or Base name |

---

## Quick start

### Agent setup (required)

**Prerequisites**

- **Node.js**: v18 or newer
- **CROO account**: access to [agent.croo.network](https://agent.croo.network)
- **USDC on Base** for test hires (requester wallet)

**Clone and install**

```bash
git clone https://github.com/alexnjoya/crooremi.git
cd crooremi
cp .env.example .env
npm install
```

**Configure env vars**

Minimum for local dev:

- `CROO_SDK_KEY` — Agent dashboard → your agent → SDK key
- `CROO_SERVICE_ID_CREATE_ENS` — ENS Payout Identity service ID
- `CROO_SERVICE_ID_CREATE_POLICY` — USDC Split Policy service ID
- `CROO_SERVICE_ID_EXECUTE_PAYMENT` — USDC Split Execution (payroll) service ID
- `CROO_SERVICE_ID_RESOLVE_ENS` — ENS Resolver service ID
- `CROO_SERVICE_ID_INSTANT_USDC_PAY` — Instant USDC Pay service ID
- `BASE_RPC_URL` — e.g. `https://mainnet.base.org`
- `USDC_ADDRESS` — Base USDC token address
- `DATABASE_URL` — Neon Postgres connection string for policy store

Optional but recommended:

- `ENS_REGISTRAR_PRIVATE_KEY` — operator wallet for Base names gas
- `ROUTER_ADDRESS` / `ROUTER_EXECUTOR_ADDRESS` — on-chain splitter path
- `PROVIDER_PAYOUT_PRIVATE_KEY` — disbursement signer (if using Router / EOA)

See `.env.example` and [docs/CAP_INTEGRATION.md](docs/CAP_INTEGRATION.md) for the full table and production notes.

**Run the provider**

```bash
npm run dev
```

Health check: `GET http://localhost:3001/health`

**Smoke tests**

```bash
npm run verify:flow    # local CAP + policy flow
npm run verify:llm     # LangChain parsing (needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
npm run journey        # full scripted journey
```

### Demo UI (optional)

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Opens at `http://localhost:3000` — split preview + link to hire on Agent Store. See [docs/WEB.md](docs/WEB.md).

### Deploy

Docker + Railway config included (`Dockerfile`, `railway.toml`). Provider must stay online for Agent Store **Online** status.

---

## CAP / SDK integration

Package: [`@croo-network/sdk`](https://docs.croo.network)

### Provider side (this repo)

WebSocket provider: `src/cap/server.ts`

| SDK primitive | Where | Use |
|---------------|-------|-----|
| `connectWebSocket()` | `cap/server.ts` | Keep provider **Online**; receive CAP events |
| `getNegotiation()` | `cap/server.ts`, `cap/handlers.ts` | Read requirements for new negotiations |
| `acceptNegotiation()` | `cap/handlers.ts` | Accept non-fund services (`createEnsName`, `createPolicy`, `resolveEnsName`) |
| `acceptNegotiationWithFundAddress()` | `cap/handlers.ts` | Accept fund-transfer services (`executePaymentJob`, `instantUsdcPay`) and declare fund address (Router, payout EOA, or recipient) |
| `rejectNegotiation()` | `cap/server.ts` | Reject bad or unsupported negotiations with a reason |
| `getOrder()` | `cap/handlers.ts` | Load paid order on `order_paid` event |
| `deliverOrder()` | `cap/handlers.ts` | Return Schema JSON with `fundTxHash`, per-recipient proof, and journey guides |
| `listOrders()` | `policy/policy-lookup.ts`, `chain/provider-wallet.ts` | Resolve policies and provider AA wallet from past orders |
| `getDelivery()` | `policy/policy-lookup.ts` | Parse past `createPolicy` deliveries to rebuild policies |

Event types handled: `NegotiationCreated`, `OrderPaid`, `OrderCompleted` (`EventType` from `@croo-network/sdk`).

### Requester side (any hiring agent)

| SDK primitive | Use |
|---------------|-----|
| `negotiateOrder()` | Hire Remifi services; pass `fundAmount` + `fundToken` for payroll and instant pay |
| `payOrder()` | Pay USDC; CROO settles principal on Base (CAPVault → AA wallet, Router, or recipient) |
| `getDelivery()` | Read Schema delivery with policy, execution guide, and tx hashes |

Full service schemas, payload examples, and the **negotiate → accept → pay → deliver → get** flow are documented in [docs/CAP_INTEGRATION.md](docs/CAP_INTEGRATION.md).

**Hire Remifi from your agent:** [docs/REQUESTER.md](docs/REQUESTER.md) · [A2A composability](docs/A2A_COMPOSABILITY.md) · Export proof: `npm run export:orders`

### Integration notes

- **Services**: five CAP services are exposed — `createEnsName`, `createPolicy`, `resolveEnsName`, `executePaymentJob`, and `instantUsdcPay`.
- **Fund transfer**:
  - `executePaymentJob` and `instantUsdcPay` require **Fund transfer ON** in Agent Store.
  - `createEnsName`, `createPolicy`, and `resolveEnsName` keep fund transfer **OFF**.
- **Settlement paths**:
  - Payroll: CAP sends principal to provider fund address (Router contract or payout EOA) → Remifi executes on-chain split → `deliverOrder` returns `fundTxHash`, per-recipient `txHashes`, and `baseExplorer` URL.
  - Instant USDC Pay: CAP sends principal **directly to the recipient address**; no Router or payout wallet.
- **Policy persistence**: policies are stored in Postgres (`DATABASE_URL`) and can be re-derived from past `createPolicy` orders via `policyId`.
- **LLM usage**: LangChain is optional; if no LLM keys are set, the agent still accepts fully-specified JSON requirements.

---

## A2A composability

Remifi is a **hireable payout primitive** — orchestrators, treasury bots, and other CAP agents add it as a split leg instead of building payroll infrastructure.

| Pattern | What it proves |
|---------|----------------|
| `createPolicy` → `executePaymentJob` | Multi-hire payroll chain per agent |
| Agent A creates policy · Agent B executes | Cross-agent composability via portable `policyId` |
| All 5 services hired | Breadth — ENS, policy, execute, resolve, instant pay |

```bash
npm run export:orders      # A2A scorecard + docs/ORDERS.json for judges
npm run a2a:cross-agent    # two agents, one policy, one execution
npm run a2a:hire           # third hiring agent (set CROO_THIRD_AGENT_SDK_KEY)
```

Full guide: [docs/A2A_COMPOSABILITY.md](docs/A2A_COMPOSABILITY.md)

**Disclosed test agents:** Remifi team uses registered CROO test requester agents for integration proof. State this plainly in your demo if judges ask — not implied external partnerships unless real.

---

## Demo (≤5 min)

1. **Hook** — *"Every agent builds its own splitter. We don't."*
2. **Policy** — Type a split in plain English → get `policyId`.
3. **Execute** — One hire. USDC lands in every wallet.
4. **Proof** — BaseScan + CAP delivery JSON (`fundTxHash`, per-recipient `txHash`).
5. **A2A** — Cross-agent hire: one agent creates policy, another executes (`npm run a2a:cross-agent`) or a third agent hires from Store.

Script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) · A2A proof: [docs/A2A_COMPOSABILITY.md](docs/A2A_COMPOSABILITY.md)

---

## Repo layout

```
├── src/
│   ├── cap/           # CAP WebSocket provider + handlers
│   └── policy/        # ENS, policy interpreter, payroll settlement
├── web/               # TanStack Start demo UI
├── contracts/         # Router Solidity (optional on-chain path)
├── scripts/           # verify:flow, journey, a2a, export:orders
└── docs/              # CAP, Agent Store, demo script
```

---

## Tech stack

Node.js · TypeScript · `@croo-network/sdk` · viem on **Base** · USDC · Base Names (`*.base.eth`) · LangChain (optional NL parsing) · Neon Postgres · Zod

---

## Links

| | |
|---|---|
| **Agent Store** | https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10 |
| **CROO docs** | https://docs.croo.network |
| **Hackathon** | https://dorahacks.io/hackathon/croo-hackathon/detail |
| **Discord** | https://discord.gg/y3xHr3t8nx |

## License

MIT — see [LICENSE](LICENSE).
