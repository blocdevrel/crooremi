import type { PrivateKeyAccount } from "viem/accounts";
import { env } from "../config.js";
import { accountFromPrivateKey } from "./chain-clients.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

let cachedAccount: PrivateKeyAccount | undefined;

function payoutPrivateKey(): string | undefined {
  const dedicated = env.PROVIDER_PAYOUT_PRIVATE_KEY?.trim();
  if (dedicated) {
    return dedicated;
  }
  return env.ENS_REGISTRAR_PRIVATE_KEY?.trim();
}

/** EOA that receives CAP fund transfers and signs USDC payouts. */
export function getPayoutAccount(): PrivateKeyAccount | undefined {
  const key = payoutPrivateKey();
  if (!key) {
    return undefined;
  }
  if (!cachedAccount) {
    cachedAccount = accountFromPrivateKey(key);
  }
  return cachedAccount;
}

export function getPayoutWalletAddress(): `0x${string}` | undefined {
  return getPayoutAccount()?.address;
}

export function requirePayoutAccount(): PrivateKeyAccount {
  const account = getPayoutAccount();
  if (!account) {
    throw new Error(
      "PROVIDER_PAYOUT_PRIVATE_KEY (or ENS_REGISTRAR_PRIVATE_KEY) is required to disburse USDC to recipients",
    );
  }
  return account;
}

export function isValidFundAddress(value: string): value is `0x${string}` {
  return ADDRESS_RE.test(value);
}
