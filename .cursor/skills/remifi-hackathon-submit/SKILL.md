---
name: remifi-hackathon-submit
description: Validates Remifi against CROO Agent Hackathon submission requirements, anti-sybil rules, demo narrative, and DoraHacks checklist. Use when preparing submission, README, demo video, Agent Store listing, or final hackathon review.
---

# Remifi Hackathon Submission

## Five requirements (all mandatory — missing one = disqualify)

| # | Requirement | Verify |
|---|-------------|--------|
| 1 | Listed on [Agent Store](https://agent.croo.network) | Agent discoverable; services priced |
| 2 | CAP integrated, on-chain settlement | Callable; real USDC txs on Base |
| 3 | Open source MIT/Apache | Public GitHub repo + `LICENSE` |
| 4 | Demo + README | ≤5 min video; setup; SDK methods documented |
| 5 | DoraHacks BUIDL filed | [croo-hackathon](https://dorahacks.io/hackathon/croo-hackathon/detail) |

## README must include

- [ ] One-line pitch (payroll/treasury splits, not "CAP agent")
- [ ] Prerequisites (Node 18+, CROO account, USDC)
- [ ] `cp .env.example .env` + env table
- [ ] `pnpm install` / `pnpm dev` commands
- [ ] Link to `docs/CAP_INTEGRATION.md`
- [ ] Link to demo video
- [ ] Architecture diagram or link to `docs/ARCHITECTURE.md`
- [ ] Tracks: DeFi / On-chain Ops (primary), Open A2A (secondary)
- [ ] Mock agents disclosed if used (name them plainly)

## Demo video beats (≤5 min)

| Time | Show |
|------|------|
| 0:00–0:20 | Problem + NL policy typed |
| 0:20–1:30 | Policy created → USDC split on Base |
| 1:30–3:00 | **Another team's agent** hires Remifi via Store (or disclosed mock) |
| 3:00–4:00 | BaseScan txs + delivery proof JSON |
| 4:00–5:00 | Fee model (0.1–0.5% volume) + vision |

Lead with **what Remifi automates**, not protocol integration.

## Anti-sybil (reward eligibility)

| Flag | Target |
|------|--------|
| Unique counterparty agents | ≥ 3 |
| Unique buyer wallets | ≥ 5 |
| Self-trade concentration | Avoid same wallet cluster |

**Hard DQ:** fake demo, broken CAP, failed spot-check, private repo, copy-paste fork.

**Partners:** prefer CAProxy / Pygmalion; never imply partnership that doesn't exist.

## docs/ checklist

| File | Content |
|------|---------|
| `CAP_INTEGRATION.md` | SDK methods, services, order flow, sample payloads |
| `AGENT_STORE.md` | Listing steps, screenshots, service IDs |
| `ARCHITECTURE.md` | Layer diagram, what runs where |
| `DEMO_SCRIPT.md` | Video script from table above |

## Pre-submit command checklist

```text
- [ ] Provider shows Online in dashboard
- [ ] createPolicy order completes with Schema delivery
- [ ] executePaymentJob order completes with txHashes on Base
- [ ] Second agent (or Store UI) can hire Remifi
- [ ] README clone-and-run works on clean machine
- [ ] LICENSE file present (MIT)
- [ ] No secrets in repo (grep for croo_sk_, private keys)
- [ ] DoraHacks form complete with repo + video links
```

## Links

| Resource | URL |
|----------|-----|
| CROO docs | https://docs.croo.network |
| Agent Store | https://agent.croo.network |
| DoraHacks | https://dorahacks.io/hackathon/croo-hackathon/detail |
| Discord | https://discord.gg/y3xHr3t8nx |
| Base | https://base.org |

## Prize context

~$10,200 USDC pool · CROO airdrop whitelist · featured Store listing · 0% gas during launch window.
