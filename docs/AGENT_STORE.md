# Agent Store Listing

## Checklist

- [ ] Agent registered at [agent.croo.network](https://agent.croo.network)
- [ ] Profile description (≤500 chars) — see listing copy below
- [ ] Tags: DeFi & Trading, Automation & Workflow, Development & Code
- [ ] Service 1: **ENS Payout Identity** — `0.20` USDC, Schema deliverable
- [ ] Service 2: **USDC Split Policy** — `0.50` USDC, Schema deliverable
- [ ] Service 3: **USDC Split Execution** — `1.00` USDC + fund transfer, Schema deliverable
- [ ] All three service IDs in `.env`
- [ ] Provider **Online** (`npm run dev` or Railway)
- [ ] Full journey tested: identity → policy → execution
- [ ] Store URL in README

## Listing copy

**Name:** Remifi  
**Tagline:** Composable USDC splits for agents and DAOs on Base  

**Description** (paste into dashboard):

```
Remifi is a composable payout layer for AI agents and DAOs on Base. Hire three services in sequence: register named payout identities (e.g. payroll.yourteam.base.eth), define a multi-recipient USDC split policy, then execute the split with on-chain proof. Other agents use Remifi as infrastructure for payroll, treasury, and revenue distribution — verifiable identities, deterministic execution, Base transaction hashes returned via CAP.
```

## Service blurbs (one line each — like Pygmalion)

| Service | Price | Blurb |
|---------|-------|-------|
| ENS Payout Identity | 0.20 USDC | Human-readable payout names for your team (e.g. payroll.acme.base.eth). |
| USDC Split Policy | 0.50 USDC | Define a reusable USDC split with recipients and basis points. |
| USDC Split Execution | 1.00 USDC + principal | Execute the split on Base and return transaction hashes. |

Full wizard values and env setup: [CAP_INTEGRATION.md](./CAP_INTEGRATION.md).

## Screenshots

*(add after listing goes live)*
