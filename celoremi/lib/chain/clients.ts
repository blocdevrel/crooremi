import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { env } from "../config";

export function getCeloChain(): Chain {
  return celo;
}

export function createCeloPublicClient() {
  return createPublicClient({
    chain: getCeloChain(),
    transport: http(env.CELO_RPC_URL),
  });
}

export function createCeloWalletClient(account: PrivateKeyAccount) {
  return createWalletClient({
    account,
    chain: getCeloChain(),
    transport: http(env.CELO_RPC_URL),
  });
}

export function accountFromPrivateKey(key: string): PrivateKeyAccount {
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  return privateKeyToAccount(normalized as Hex);
}

export function requireAgentAccount(): PrivateKeyAccount {
  if (!env.AGENT_PRIVATE_KEY) {
    throw new Error("AGENT_PRIVATE_KEY is not set");
  }
  const account = accountFromPrivateKey(env.AGENT_PRIVATE_KEY);
  if (
    env.AGENT_ADDRESS &&
    account.address.toLowerCase() !== env.AGENT_ADDRESS.toLowerCase()
  ) {
    throw new Error(
      `AGENT_ADDRESS ${env.AGENT_ADDRESS} does not match key-derived ${account.address}`,
    );
  }
  return account;
}

export function getAgentAddress(): `0x${string}` | undefined {
  if (env.AGENT_ADDRESS) {
    return env.AGENT_ADDRESS as `0x${string}`;
  }
  if (env.AGENT_PRIVATE_KEY) {
    return accountFromPrivateKey(env.AGENT_PRIVATE_KEY).address;
  }
  return undefined;
}
