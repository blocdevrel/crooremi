# Remifi

**Payroll, treasury, and revenue splits on Celo — without building a payout stack.**

**Live:** [https://remifi.up.railway.app](https://remifi.up.railway.app) · **Identity:** [ERC-8004 #9745](https://8004scan.io/agents/celo/9745) · **Marketplace:** [Aigora](https://aigora.org/services/42220_0x8004a169fb4a3325136eb29fa0ceb6d2e539a432_9745)

[![Hackathon](https://img.shields.io/badge/Celo-Agentic%20Payments%20%26%20DeFAI-FCFF52)](https://celobuilders.xyz)
[![Track 1](https://img.shields.io/badge/Track%201-Most%20Revenue%20Generated-000)](https://dune.com/celo/agentic-payments-defai-hackathon)
[![Track 2](https://img.shields.io/badge/Track%202-Most%20x402%20Payments-35D07F)](https://x402.celo.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

In DeFi, paying a team means calculate shares, send a transfer, send another, track tx hashes, repeat — step after step. What if your agent just did all of it? **One hire. Every recipient paid. Proof on Celo.**

Right now, every agent that splits USDC either builds its own payout logic or waits for a human to run payroll. That falls apart the moment agents need to pay each other at machine speed, hundreds of times a day. Manual splits don't scale to an agent economy — and untagged transfers don't count on Celo's Track 1 leaderboard.

**Meet Remifi** — a hireable USDC payout agent on **Celo mainnet**. Describe who gets what in plain English or JSON. Execute once. Every wallet receives USDC. Every agent-sent transfer carries an **attribution tag** so Track 1 credits the volume. Real USDC. Real tx hashes. No custom splitter to build.

> *Split payroll 60% / 40%. I create the policy once. One execute later, everyone has USDC on Celo — and the transfers show our tag on Celoscan. I never wrote a transfer script. Done.*

Built for **agent-to-agent payouts** and people on [MiniPay](https://docs.minipay.xyz) / web. Other agents hire Remifi as the composable payout leg — offload splits, move at agent speed.

**Tracks:** Most Revenue Generated (primary) · Most x402 Payments (secondary) · Askbots · Aigora feedback

---

## How it works

```
1. Define the split     →  who gets what (plain English or JSON)
2. Execute once         →  USDC to every recipient
3. Prove it             →  Celoscan + attribution tag on-chain
```

| Step | What you do | What you get |
|------|-------------|--------------|
| **Policy** | Describe the split once | Reusable policy |
| **Pay** | One execute / hire | Every recipient paid on Celo |
| **Instant** | Send to one wallet or name | Single tagged USDC transfer |

Need a one-off send? Instant pay delivers in a single call. Prefer the phone wallet? Open the same app in MiniPay — it auto-connects.

---

## What you can hire

| Capability | For |
|------------|-----|
| Create policy | Multi-recipient split rules |
| Execute payroll | One hire → USDC to **all** recipients + proof |
| Instant USDC pay | Single-shot send to a wallet or name |
| Job proof | Status, tx hashes, Celoscan links |
| Health | Liveness + agent balance hint |

Hire via the [live app](https://remifi.up.railway.app), HTTP APIs, or x402. Every **Pay** / **Execute** settles an x402 hire (Track 2) then a tagged USDC transfer (Track 1).

---

## Demo (≤5 min)

1. **Hook** — *"Every agent builds its own splitter. We don't."*
2. **Policy** — Type a 60/40 split → save policy.
3. **Execute** — One pay. USDC lands in every wallet.
4. **Proof** — Celoscan shows the transfers + attribution tag.
5. **Leaderboard** — Tagged volume on [Dune](https://dune.com/celo/agentic-payments-defai-hackathon).

---

## Quick start

```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev
```

Copy vars from [`.env.example`](./.env.example) (attribution tag, agent wallet, database, optional x402 / Router). App: `http://localhost:3000`.

---

## Stack

Next.js · TypeScript · viem on **Celo** · USDC · ERC-8021 attribution · ERC-8004 identity · MiniPay · x402 · Neon Postgres

---

## Links

| | |
|---|---|
| **App** | https://remifi.up.railway.app |
| **8004scan** | https://8004scan.io/agents/celo/9745 |
| **Aigora** | https://aigora.org/services/42220_0x8004a169fb4a3325136eb29fa0ceb6d2e539a432_9745 |
| **Leaderboard** | https://dune.com/celo/agentic-payments-defai-hackathon |
| **Builders** | https://celobuilders.xyz |
| **Explorer** | https://celoscan.io |

## License

MIT — see [LICENSE](../LICENSE).
