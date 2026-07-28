import { env, isX402Enabled } from "../config";
import { settleAgentSignedHire } from "../x402";

export type X402TrafficResult = {
  enabled: boolean;
  attempted: number;
  ok: number;
  failed: number;
  stoppedReason?: string;
  settlements: Array<{
    index: number;
    status: "ok" | "failed";
    txHash?: string;
    error?: string;
  }>;
};

/**
 * x402 traffic burst: real hire settlements each heartbeat.
 * Each settle is an EIP-3009 payment via api.x402.celo.org → Track 2 volume.
 */
export async function runX402TrafficBurst(): Promise<X402TrafficResult> {
  if (!env.X402_TRAFFIC_ENABLED) {
    return {
      enabled: false,
      attempted: 0,
      ok: 0,
      failed: 0,
      stoppedReason: "disabled",
      settlements: [],
    };
  }

  if (env.X402_TRAFFIC_END) {
    const end = Date.parse(env.X402_TRAFFIC_END);
    if (Number.isFinite(end) && Date.now() >= end) {
      return {
        enabled: true,
        attempted: 0,
        ok: 0,
        failed: 0,
        stoppedReason: "past_end",
        settlements: [],
      };
    }
  }

  if (!isX402Enabled()) {
    return {
      enabled: true,
      attempted: 0,
      ok: 0,
      failed: 0,
      stoppedReason: "x402_not_configured",
      settlements: [],
    };
  }

  const count = env.X402_TRAFFIC_PER_TICK;
  const settlements: X402TrafficResult["settlements"] = [];
  let ok = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < count; i++) {
    const resource = `/api/quote#traffic-${Date.now()}-${i}`;
    try {
      const hire = await settleAgentSignedHire(resource);
      ok += 1;
      consecutiveFailures = 0;
      settlements.push({
        index: i,
        status: "ok",
        ...(hire.settlementTxHash ? { txHash: hire.settlementTxHash } : {}),
      });
    } catch (err) {
      failed += 1;
      consecutiveFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      settlements.push({ index: i, status: "failed", error: message.slice(0, 200) });
      // Bail early on persistent underfund / facilitator issues
      if (
        consecutiveFailures >= 5 ||
        /insufficient_funds|X402_API_KEY|not set/i.test(message)
      ) {
        return {
          enabled: true,
          attempted: i + 1,
          ok,
          failed,
          stoppedReason: consecutiveFailures >= 5 ? "consecutive_failures" : "hard_error",
          settlements,
        };
      }
    }
  }

  return {
    enabled: true,
    attempted: count,
    ok,
    failed,
    settlements,
  };
}
