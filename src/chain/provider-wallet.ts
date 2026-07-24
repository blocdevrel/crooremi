import type { AgentClient } from "@croo-network/sdk";
import { env } from "../config.js";
import {
  getPayoutWalletAddress,
  isValidFundAddress,
} from "./payout-wallet.js";
import { getRouterAddress } from "./router.js";

let cachedAaWallet: `0x${string}` | undefined;

/**
 * Address declared at acceptNegotiationWithFundAddress.
 * Prefer Router (CAP fund → contract → one-tx split).
 */
export async function getProviderFundAddress(
  _client?: AgentClient,
): Promise<`0x${string}`> {
  const router = getRouterAddress();
  if (router) {
    console.log(`[remifi] fund-transfer accept → Router ${router}`);
    return router;
  }

  const fromPayoutKey = getPayoutWalletAddress();
  if (fromPayoutKey) {
    return fromPayoutKey;
  }

  const fromEnv = env.PROVIDER_AA_WALLET_ADDRESS?.trim();
  if (fromEnv && isValidFundAddress(fromEnv)) {
    console.warn(
      "[remifi] PROVIDER_AA_WALLET_ADDRESS is set but no payout private key — " +
        "USDC will arrive but cannot be disbursed. Set PROVIDER_PAYOUT_PRIVATE_KEY.",
    );
    return fromEnv.toLowerCase() as `0x${string}`;
  }

  if (cachedAaWallet) {
    return cachedAaWallet;
  }

  if (_client) {
    const orders = await _client.listOrders({ role: "provider", pageSize: 20 });
    for (const order of orders) {
      const wallet = order.providerFundAddress?.trim() ?? order.providerWalletAddress?.trim();
      if (wallet && isValidFundAddress(wallet)) {
        cachedAaWallet = wallet.toLowerCase() as `0x${string}`;
        console.log(`[remifi] resolved provider fund address from CROO orders: ${cachedAaWallet}`);
        return cachedAaWallet;
      }
    }
  }

  throw new Error(
    "Set ROUTER_ADDRESS (recommended) or PROVIDER_PAYOUT_PRIVATE_KEY. " +
      "Fund-transfer accept needs an address; disbursement requires router or payout key.",
  );
}
