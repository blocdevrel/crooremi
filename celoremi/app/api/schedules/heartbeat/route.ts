import { jsonError, jsonOk } from "@/lib/http";
import { runDueSchedules } from "@/lib/schedules/heartbeat";
import { env } from "@/lib/config";

function assertHeartbeatAuth(req: Request): void {
  const configured = env.EXECUTE_API_KEY;
  if (!configured) {
    if (env.NODE_ENV !== "production") return;
    throw new Error("EXECUTE_API_KEY required for heartbeat");
  }
  const bearer = req.headers.get("authorization");
  const headerKey = req.headers.get("x-api-key");
  const provided =
    headerKey?.trim() ||
    (bearer?.toLowerCase().startsWith("bearer ")
      ? bearer.slice(7).trim()
      : undefined);
  if (!provided || provided !== configured) {
    throw new Error("Invalid or missing API key");
  }
}

/** POST /api/schedules/heartbeat — due Auto payroll + x402 traffic burst. */
export async function POST(req: Request) {
  try {
    assertHeartbeatAuth(req);
    const result = await runDueSchedules();
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}

export async function GET() {
  return jsonOk({
    ok: true,
    service: "remifi-heartbeat",
    description:
      "POST with x-api-key: due Auto payroll + x402 traffic burst (Track 2).",
    cadence: "Call every 5–20 minutes from Railway cron.",
    path: "/api/schedules/heartbeat",
    traffic: {
      enabled: Boolean(env.X402_TRAFFIC_ENABLED),
      perTick: env.X402_TRAFFIC_PER_TICK,
      end: env.X402_TRAFFIC_END ?? null,
    },
  });
}
