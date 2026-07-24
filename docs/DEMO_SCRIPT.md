# Remifi — Video Demo Script (≤5 min)

**Goal:** Show real USDC on Base, five hireable CAP services, and why other agents compose Remifi — not "we integrated CAP."

**Before recording**

- [ ] Provider **Online** (`npm run dev` or Railway)
- [ ] Requester wallet funded with USDC on Base (fees + split principal)
- [ ] `DEV_MOCK_SETTLEMENT=false` in production
- [ ] Tab 1: [Agent Store — Remifi](https://agent.croo.network/agents/fd57334e-5e6f-4b76-9d5f-da0202f23a10)
- [ ] Tab 2: [BaseScan](https://basescan.org) (ready to paste tx hashes)
- [ ] Optional terminal: `npm run journey` as backup if Store UI is slow

Replace `0x742d…` and `0x1234…` with your test wallets. Use a fresh `org` label if ENS names are already taken (e.g. `demojul1`).

---

## 0:00–0:25 — Hook

**[Screen: Agent Store → Remifi profile, status Online, five services visible]**

> "AI agents and DAOs still split payroll and treasury manually — copy addresses, run spreadsheets, hope nothing breaks.
>
> Remifi is a hireable payout layer on CROO. Other agents discover it on the Agent Store, pay in USDC, and get auditable splits on Base — with human-readable payment names like `payroll.yourteam.base.eth`."

---

## 0:25–1:00 — ENS Lookup (verify before you pay)

**[Screen: Hire **ENS Lookup** → paste Try this → Pay → Delivery]**

**Say:**

> "Before sending money, agents can verify payout identities. ENS Lookup resolves names forward and reverse on Base — read-only, no registration."

**Try this (Requirements):**

```json
{ "text": "team.demojul1.base.eth" }
```

Or reverse:

```json
{ "text": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0" }
```

**Show delivery:** `results[]` with resolved `0x` address (or name on reverse lookup).

---

## 1:00–2:00 — USDC Split Policy (the rules)

**[Screen: Hire **USDC Split Policy** → Requirements → Delivery with `policyId`]**

**Say:**

> "Next I define the split. Natural language or JSON — LangChain turns it into a validated policy with basis points and resolved addresses. Copy the `policyId` for execution."

**Try this — Text (needs AI key on provider):**

```
Under org demojul1, split 60% to team at 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0 and 40% to ops at 0x1234567890123456789012345678901234567890
```

**Try this — Schema (no LLM):**

```json
{
  "org": "demojul1",
  "name": "Payroll split",
  "recipients": [
    { "subname": "team", "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0", "label": "team", "bps": 6000 },
    { "subname": "ops", "address": "0x1234567890123456789012345678901234567890", "label": "ops", "bps": 4000 }
  ]
}
```

**Show delivery:** `policyId` (e.g. `pol_…`), `policy.recipients[]`, optional `ens` fields like `team.demojul1.base.eth`.

**Optional cutaway (10 sec):** If you registered names first, show **ENS Payout Identity** delivery with `txHashes` on BaseScan. Skip if policy already provisioned subnames.

---

## 2:00–3:30 — USDC Split Execution (the money shot)

**[Screen: Hire **USDC Split Execution** → fund transfer ON → pay principal + fee → wait for delivery]**

**Say:**

> "One hire pays every recipient. I send the split principal plus the service fee in USDC. Remifi executes deterministically — no LLM in the payment path — and returns a transaction hash for each recipient on Base."

**Try this (paste `policyId` from previous step):**

```json
{
  "policyId": "pol_PASTE_FROM_STEP_2",
  "totalUsdc": "1000000"
}
```

> `1000000` = 1.00 USDC (6 decimals). Use a smaller amount for demo if you prefer: `100000` = 0.10 USDC.

**While order runs:** Briefly mention provider WebSocket accepting → `payOrder` → disbursement.

**Show delivery:**

- `fundTxHash` — CROO payroll funding
- `recipients[].txHash` — per-recipient USDC transfers
- `baseExplorer` link

---

## 3:30–4:15 — On-chain proof

**[Screen: BaseScan — open `fundTxHash` and at least one recipient `txHash`]**

**Say:**

> "This isn't a mock receipt. Every delivery includes Base transaction hashes judges and hiring agents can verify. The CAP order completes with structured JSON proof — that's what makes Remifi composable infrastructure, not a terminal chatbot."

**[Screen: Agent Store order history — Completed, delivery JSON expanded]**

---

## 4:15–4:45 — Instant USDC Pay (bonus: one-shot)

**[Screen: Hire **Instant USDC Pay** — fund transfer ON]**

**Say:**

> "Not every job needs a multi-recipient policy. Instant USDC Pay is a single send to any wallet or `.base.eth` name — same CAP hire model, same on-chain receipt."

**Try this:**

```json
{ "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0", "amount": "100000" }
```

Or natural language:

```
Send 0.10 USDC to team.demojul1.base.eth
```

**Show delivery:** `txHash`, `amount`, `to` / resolved `ens`.

---

## 4:45–5:00 — Close (A2A + vision)

**[Screen: Agent Store services list — all five, order counts]**

**Say:**

> "Remifi is infrastructure other agents hire: verify identities, define splits, execute payroll, or send a one-off payment — all through CAP with real USDC on Base.
>
> An orchestrator like CAProxy or a creator agent like Pygmalion can add Remifi as their payout leg instead of building their own splitter. That's agent-to-agent composability — the point of the CROO hackathon."

**End card (optional):** GitHub repo · Agent Store link · `dorahacks.io/hackathon/croo-hackathon`

---

## Backup: scripted terminal demo

If the Store UI lags on camera:

```bash
npm run journey
```

Chains ENS → policy → execution automatically. Cut terminal B-roll with BaseScan proof from the journey output.

---

## What judges need to see (checklist)

| Beat | Covered in |
|------|------------|
| Real USDC on Base | Split Execution + BaseScan |
| CAP integrated | Store hire → pay → delivery |
| A2A composability | Close + "other agents hire Remifi" |
| Five services | Store overview + Lookup + Policy + Execute + Instant Pay |
| Not fake / not mock | `DEV_MOCK_SETTLEMENT=false`, real tx hashes |

---

## Short version (~3 min)

If you need a tighter cut, drop ENS Lookup and Instant USDC Pay:

1. Hook (15 s)
2. USDC Split Policy — NL input (45 s)
3. USDC Split Execution — pay + delivery (90 s)
4. BaseScan proof (30 s)
5. A2A close (20 s)
