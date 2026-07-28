import { getAddress } from "viem";
import { routerAbi } from "../abi";
import { env } from "../config";
import { createCeloPublicClient, getAgentAddress } from "./clients";
import { getRouterAddress, isRouterConfigured } from "./router";

export type RouterHealth = {
  configured: boolean;
  address: `0x${string}` | null;
  ok: boolean | null;
  token: string | null;
  executor: string | null;
  error: string | null;
};

export async function readRouterHealth(): Promise<RouterHealth> {
  const address = getRouterAddress() ?? null;
  if (!isRouterConfigured() || !address) {
    return {
      configured: false,
      address: null,
      ok: null,
      token: null,
      executor: null,
      error: null,
    };
  }

  if (env.DEV_MOCK_PAYOUT) {
    return {
      configured: true,
      address,
      ok: true,
      token: env.USDC_ADDRESS,
      executor: getAgentAddress() ?? null,
      error: null,
    };
  }

  try {
    const client = createCeloPublicClient();
    const agent = getAgentAddress();
    const [token, executor] = await Promise.all([
      client.readContract({
        address,
        abi: routerAbi,
        functionName: "token",
      }),
      client.readContract({
        address,
        abi: routerAbi,
        functionName: "executor",
      }),
    ]);

    const tokenAddr = getAddress(token as string);
    const executorAddr = getAddress(executor as string);
    const usdcOk =
      tokenAddr.toLowerCase() === env.USDC_ADDRESS.toLowerCase();
    const executorOk = Boolean(
      agent && executorAddr.toLowerCase() === agent.toLowerCase(),
    );

    let error: string | null = null;
    if (!usdcOk) {
      error = `Router token ${tokenAddr} != USDC ${env.USDC_ADDRESS}`;
    } else if (!executorOk) {
      error = `Router executor ${executorAddr} != AGENT_ADDRESS ${agent}`;
    }

    return {
      configured: true,
      address,
      ok: usdcOk && executorOk,
      token: tokenAddr,
      executor: executorAddr,
      error,
    };
  } catch (err) {
    return {
      configured: true,
      address,
      ok: false,
      token: null,
      executor: null,
      error: err instanceof Error ? err.message : "router health failed",
    };
  }
}
