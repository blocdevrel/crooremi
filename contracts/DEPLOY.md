# Router — deploy on Base

## What it does

CAP `payOrder` sends payroll USDC to **this contract** (`providerFundAddress`). After `order_paid`, Remifi calls `executeSplit` once → all recipients paid in **one Base tx**.

## 1. Test locally

```bash
cd contracts
forge test -vv
```

## 2. Deploy (Base mainnet)

Set env (use a **fresh deployer** or your operator wallet):

```bash
export BASE_RPC_URL=https://mainnet.base.org
export DEPLOYER_PRIVATE_KEY=0x...          # pays deploy gas
export USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
export ROUTER_EXECUTOR_ADDRESS=0x...       # Remifi server signer (PROVIDER_PAYOUT_PRIVATE_KEY address)
```

```bash
cd contracts
forge script script/DeployRouter.s.sol:DeployRouter \
  --rpc-url $BASE_RPC_URL \
  --broadcast
```

Copy the deployed address → root `.env`:

```bash
ROUTER_ADDRESS=0x...
ROUTER_EXECUTOR_ADDRESS=0x...   # same as executor in constructor
PROVIDER_PAYOUT_PRIVATE_KEY=0x... # must control ROUTER_EXECUTOR_ADDRESS
```

Remove or ignore `PROVIDER_AA_WALLET_ADDRESS` for execute — fund must go to the **router**.

## 3. Remifi + CAP wiring

| Step | Action |
|------|--------|
| Accept | `acceptNegotiationWithFundAddress(negotiationId, ROUTER_ADDRESS)` |
| Pay | Requester `payOrder` → USDC lands on router |
| Execute | Remifi `executeSplit(orderKey, recipients[], amounts[], expectedTotal)` |
| Deliver | `deliverOrder` with split tx hash + recipient amounts |

`orderKey` = `keccak256(bytes(capOrderId))` — handled in `src/chain/router.ts`.

## 4. Verify on BaseScan

After one execute hire:

- Inbound USDC: `fundTxHash` (CAP payOrder)
- Split tx: same hash on all recipients in delivery JSON
- Recipient wallets show USDC balance increase
