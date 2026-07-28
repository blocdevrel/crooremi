import { jsonOk } from "@/lib/http";

/** Discovery/health response for POST-only hire endpoints (8004scan probes with GET). */
export function serviceDiscover(meta: {
  name: string;
  method: "POST" | "GET";
  path: string;
  description: string;
  body?: Record<string, unknown>;
  notes?: string[];
}) {
  return jsonOk({
    ok: true,
    service: "remifi",
    name: meta.name,
    method: meta.method,
    path: meta.path,
    description: meta.description,
    body: meta.body ?? null,
    notes: meta.notes ?? [],
    x402Support: true,
    network: "celo-mainnet",
    health: "https://remifi.up.railway.app/api/health",
  });
}
