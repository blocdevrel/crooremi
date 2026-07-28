import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function GET() {
  try {
    const path = join(process.cwd(), "public", ".well-known", "agent-card.json");
    const raw = readFileSync(path, "utf8");
    return new Response(raw, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    // Fallback if standalone cwd differs
    const url = new URL(
      "/.well-known/agent-card.json",
      "https://remifi.up.railway.app",
    );
    return Response.redirect(url, 307);
  }
}
