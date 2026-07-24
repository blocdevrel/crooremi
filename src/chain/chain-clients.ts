import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { env } from "../config.js";

export function getBaseChain(): Chain {
  return env.BASE_CHAIN_ID === baseSepolia.id ? baseSepolia : base;
}

export function createBasePublicClient() {
  return createPublicClient({
    chain: getBaseChain(),
    transport: http(env.BASE_RPC_URL),
  });
}

export function createBaseWalletClient(account: PrivateKeyAccount) {
  return createWalletClient({
    account,
    chain: getBaseChain(),
    transport: http(env.BASE_RPC_URL),
  });
}

export function accountFromPrivateKey(key: string): PrivateKeyAccount {
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  return privateKeyToAccount(normalized as `0x${string}`);
}
