import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonOk } from "@/lib/http";

const CARD_URL =
  "https://remifi.up.railway.app/.well-known/agent-card.json";

function loadCard(): Record<string, unknown> {
  try {
    const path = join(process.cwd(), "public", ".well-known", "agent-card.json");
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {
      name: "Remifi",
      description: "Hireable USDC payroll agent on Celo",
      url: "https://remifi.up.railway.app/api/a2a",
      version: "1.0.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      skills: [],
    };
  }
}

/** A2A discovery + lightweight JSON-RPC health for 8004scan probes. */
export async function GET() {
  const card = loadCard();
  return jsonOk({
    ok: true,
    protocol: "a2a",
    agentCard: CARD_URL,
    ...card,
    url: "https://remifi.up.railway.app/api/a2a",
  });
}

export async function POST(req: Request) {
  let body: { jsonrpc?: string; id?: unknown; method?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body ok for health probes
  }

  const method = body.method ?? "health";
  const id = body.id ?? 1;

  if (method === "health" || method === "ping" || method === "agent/getAuthenticatedExtendedCard") {
    const card = loadCard();
    return jsonOk({
      jsonrpc: "2.0",
      id,
      result: {
        ok: true,
        agentCard: CARD_URL,
        agent: card,
      },
    });
  }

  return jsonOk({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}. Hire Remifi via HTTP: POST /api/policies, /api/execute, /api/pay`,
    },
  });
}
