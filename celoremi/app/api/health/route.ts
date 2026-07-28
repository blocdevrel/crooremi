import { erc20Abi, formatUnits } from "viem";
import { getAgentAddress, createCeloPublicClient } from "@/lib/chain/clients";
import { readRouterHealth } from "@/lib/chain/router-health";
import {
  env,
  USDC_DECIMALS,
  getX402PayTo,
  isX402Enabled,
} from "@/lib/config";
import { jsonOk } from "@/lib/http";

export async function GET() {
  const agent = getAgentAddress();
  let usdcBalance: string | null = null;
  let usdcBalanceFormatted: string | null = null;
  let chainOk = false;
  let chainError: string | null = null;
  let facilitatorOk: boolean | null = null;

  try {
    const client = createCeloPublicClient();
    await client.getBlockNumber();
    chainOk = true;

    if (agent) {
      const balance = await client.readContract({
        address: env.USDC_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [agent],
      });
      usdcBalance = balance.toString();
      usdcBalanceFormatted = formatUnits(balance, USDC_DECIMALS);
    }
  } catch (err) {
    chainError = err instanceof Error ? err.message : "chain error";
  }

  try {
    const base =
      env.X402_FACILITATOR_URL === "https://x402.celo.org"
        ? "https://api.x402.celo.org"
        : env.X402_FACILITATOR_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/supported`, { cache: "no-store" });
    facilitatorOk = res.ok;
  } catch {
    facilitatorOk = false;
  }

  const router = await readRouterHealth();

  return jsonOk({
    ok: true,
    service: "remifi",
    tracks: ["most-revenue-generated", "most-x402-payments"],
    network: "celo-mainnet",
    chainId: env.CELO_CHAIN_ID,
    usdc: env.USDC_ADDRESS,
    attributionTagConfigured: Boolean(env.ATTRIBUTION_TAG),
    agentAddress: agent ?? null,
    x402: {
      enabled: isX402Enabled(),
      payTo: getX402PayTo() ?? null,
      hirePrice: env.X402_HIRE_PRICE.toString(),
      facilitator: env.X402_FACILITATOR_URL,
      facilitatorOk,
      hireGate: isX402Enabled() ? "x402_then_tagged_payout" : "api_key_or_open_dev",
    },
    router,
    usdcBalance,
    usdcBalanceFormatted,
    chainOk,
    chainError,
    mockPayout: Boolean(env.DEV_MOCK_PAYOUT),
    payrollMode: router.configured ? "router_payroll" : "wallet_payroll",
    executeAuthRequired: Boolean(env.EXECUTE_API_KEY),
  });
}
