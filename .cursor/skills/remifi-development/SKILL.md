---
name: remifi-development
description: Builds the Remifi CAP payment-splitting agent for the CROO hackathon. Use when working on Remifi code, repo structure, agent server, USDC splits on Base, policy interpreter, demo UI, or anything under agent/, web/, contracts/, or docs/. Covers architecture, MVP scope, and coding conventions.
---

# Remifi Development

## Read first

| Doc | Path |
|-----|------|
| Product plan | `remifi.md` |
| Dev structure | `devplan.md` |
| Architecture detail | [reference.md](reference.md) |

## What Remifi is

Callable AI agent on **CROO CAP** that receives USDC on **Base** and splits it to multiple recipients per a natural-language or JSON policy. Primary tracks: **DeFi / On-chain Ops** + **Open A2A**.

**Demo headline:** payroll / treasury / revenue splits — not "we integrated CAP."

## Stack (do not deviate without reason)

| Layer | Choice |
|-------|--------|
| Agent runtime | Node.js 18+ / TypeScript |
| CAP | `@croo-network/sdk` |
| Chain | viem on Base |
| Stablecoin | USDC only |
| Demo UI | Next.js (thin) — optional |
| Settlement | CROO SDK `payOrder` + `deliverOrder` (payroll) |

## CROO vs Base

- **CROO** = commerce layer (CAP, Agent Store, identity). Not a blockchain.
- **Base** = where USDC settles on-chain.
- Agent AA wallet is created by CROO dashboard. CROO sponsors gas for CAP orders.

## Repo layout

**Repo root = workspace root** (`hackathon/`). Flat layout — no nested `remifi/` code folder.

```
hackathon/                  # repo root
├── remifi.md               # product plan
├── src/{cap,policy,chain}/ # core provider
├── web/                    # demo UI placeholder
├── docs/                   # CAP_INTEGRATION, AGENT_STORE, DEMO_SCRIPT
└── scripts/                # verify-flow, journey, railway sync
```

## MVP build order

```
1. CAP provider online
2. policy/interpreter.ts + llm.ts — LangChain policy parsing
3. chain/payroll-settlement.ts — CROO SDK payroll delivery
4. cap/handlers.ts — four CAP services
5. npm run verify:flow + npm run journey
6. docs + README + Store listing + video
```

## Code conventions

- **Minimal scope** — smallest diff that works; no abstractions for one caller.
- **Match existing style** in each folder once files exist.
- **Secrets** — `.env` only; never commit keys. Document vars in `.env.example`.
- **Types** — define `SplitPolicy` and `SplitRecipient` in `agent/src/policy/` or `config.ts`.
- **Errors** — return structured delivery JSON to CAP on failure; include reason string.
- **Proofs** — every `executePaymentJob` delivery includes Base tx hashes array.

## SplitPolicy shape (canonical)

```typescript
type SplitRecipient = { address: `0x${string}`; label: string; bps: number };
type SplitPolicy = {
  id: string;
  name: string;
  recipients: SplitRecipient[]; // bps must sum to 10000
};
```

## USDC split flow (MVP — no custom contracts)

1. CAP order paid → USDC in agent AA wallet (via CAPVault settlement).
2. Parse job input → `SplitPolicy` + total amount.
3. For each recipient: `usdc.write.transfer([address, amount])` via viem.
4. `DeliverOrder` with `{ policyId, txHashes, recipients }`.

## Services to register on Agent Store

| Service | Input | Output |
|---------|-------|--------|
| `createPolicy` | Text or Schema (policy spec) | Schema (`SplitPolicy`) |
| `executePaymentJob` | Schema (policyId or inline policy + amount) | Schema (tx proof) |

## Do not over-build

Skip unless user explicitly asks: Foundry, Docker, ERC-4337 custom wallet, ENS automation, LangChain folder tree, E2E Playwright, Base miniapp before CAP works.

## When stuck

Query CROO docs: `GET https://docs.croo.network/developer-docs/quick-start.md?ask=<question>`

Links: [docs.croo.network](https://docs.croo.network) · [agent.croo.network](https://agent.croo.network) · [DoraHacks](https://dorahacks.io/hackathon/croo-hackathon/detail)
