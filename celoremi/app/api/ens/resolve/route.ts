import { z } from "zod";
import { resolveAddressInput } from "@/lib/ens/resolve";
import { jsonError, jsonOk } from "@/lib/http";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET() {
  return serviceDiscover({
    name: "resolveEnsName",
    method: "POST",
    path: "/api/ens/resolve",
    description: "Resolve and verify a wallet, ENS, or Base name before you pay.",
    body: { query: "vitalik.eth" },
  });
}

const bodySchema = z.object({
  /** ENS name, Base name, or 0x address (or comma-separated list) */
  query: z.string().min(1).max(500).optional(),
  queries: z.array(z.string().min(1)).min(1).max(10).optional(),
}).refine((b) => Boolean(b.query?.trim()) || Boolean(b.queries?.length), {
  message: "Provide query or queries[]",
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const list =
      body.queries ??
      body
        .query!.split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

    const results = [];
    for (const input of list.slice(0, 10)) {
      try {
        const resolved = await resolveAddressInput(input);
        results.push({
          input,
          resolved: true,
          address: resolved.address,
          ens: resolved.ens ?? null,
          chain: resolved.chain ?? null,
        });
      } catch (err) {
        results.push({
          input,
          resolved: false,
          error: err instanceof Error ? err.message : "resolve failed",
        });
      }
    }

    return jsonOk({
      success: results.every((r) => r.resolved),
      results,
    });
  } catch (err) {
    return jsonError(err);
  }
}
