# Optional Web UI

You do **not** need a web app for the hackathon. Build this only for demo polish or human-friendly policy preview.

## What the web is NOT

| Do not build on Remifi web | Why |
|----------------------------|-----|
| Wallet connect to pay for CAP jobs | Hiring + USDC payment happens on **[CROO Agent Store](https://agent.croo.network)** or via CAP SDK |
| CAP order lifecycle | Lives in `agent/` (`@croo-network/sdk`) |
| Agent registration / API keys | CROO dashboard only |

**Rule:** Real money flows through CROO → your agent → Base. The web never holds keys or processes CAP payments in MVP.

## What the web CAN do

| Purpose | Good for |
|---------|----------|
| **Policy playground** | Type NL policy → see split preview (addresses, %, USDC amounts) |
| **Demo video** | Visual story for judges |
| **Read-only proof** | Show tx hashes + BaseScan links after a real CAP job ran |
| **Marketing** | Explain what Remifi does; CTA → "Hire on Agent Store" |

## Two build modes

### A. Demo-only (fastest)

- Mock parse + mock execute (client state)
- No backend, no wallet
- Link: **Hire on CROO** → Agent Store
- Good for: 5-min video in 1–2 days

Run from `web/`: `bun install` then `bun run dev`

### B. Connected (after agent works)

Web calls your agent API; agent still owns CAP + chain.

```
Browser → web/ → agent HTTP API → (optional) read chain for tx status
                      ↑
                 CAP provider (separate process)
```

| Endpoint | Method | Body | Returns |
|----------|--------|------|---------|
| `/api/health` | GET | — | `{ online: true }` |
| `/api/policy/parse` | POST | `{ text: string }` | `SplitPolicy` |
| `/api/policy/preview` | POST | `{ policy, amountUsdc }` | `{ recipients: [{ label, amount }] }` |
| `/api/executions/latest` | GET | — | Last real CAP delivery (tx hashes) |

**Execute still happens via CAP** — web does not trigger splits directly in production. For demo you can show the latest execution result your agent stored after an Agent Store hire.

## Minimal pages (one screen is enough)

1. **Hero** — tagline + "Hire on CROO" button  
2. **Policy input** — textarea + template chips  
3. **Split preview** — table + chart  
4. **Proof panel** — stepper + BaseScan links (from last job or mock)  
5. **Footer** — Agent Store link, Base, USDC  

No login. No wallet connect unless you add optional "paste address for preview only."

## Stack (match repo)

- TanStack Start + Vite in `web/`
- Tailwind + shadcn/ui
- viem **read-only** for BaseScan / balance display (optional)

## Env (`web/.env.local`)

```bash
VITE_AGENT_STORE_URL=https://agent.croo.network
VITE_BASESCAN_URL=https://sepolia.basescan.org
VITE_AGENT_HEALTH_URL=http://localhost:3001/health   # if mode B
```

No `CROO_SDK_KEY` in the web app — keys stay in `agent/` only.

## Demo video flow (with web)

1. Show web: type policy → preview split  
2. Switch to **Agent Store**: hire Remifi, pay USDC (real)  
3. Back to web or terminal: show proof / BaseScan txs  
4. Say: "Other agents can do the same step via CAP without this UI"

## When to skip web entirely

- Less than 3 days to deadline  
- Agent + CAP not working yet — fix `agent/` first  
- Demo works fine with Store + terminal + BaseScan  

## File layout

```
web/
├── src/
│   ├── routes/
│   │   └── index.tsx      # single-page demo
│   ├── components/
│   └── lib/
├── vite.config.ts
└── package.json
```
