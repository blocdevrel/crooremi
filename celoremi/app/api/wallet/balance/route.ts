import { readWalletUsdcBalance } from "@/lib/minipay/balance";
import { jsonError, jsonOk } from "@/lib/http";
import type { Address } from "viem";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return jsonError("Valid wallet address required", 400);
  }

  try {
    const balance = await readWalletUsdcBalance(address as Address);
    return jsonOk({ address, balance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Balance lookup failed";
    return jsonError(message, 500);
  }
}
