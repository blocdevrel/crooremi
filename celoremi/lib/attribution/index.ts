import { toDataSuffix, verifyTx } from "@celo/attribution-tags";
import type { Hex } from "viem";
import { env } from "../config";
import { createCeloPublicClient } from "../chain/clients";

export function requireAttributionTag(): string {
  if (!env.ATTRIBUTION_TAG) {
    throw new Error(
      "ATTRIBUTION_TAG is not set — register at celobuilders.xyz and lock the tag in env",
    );
  }
  return env.ATTRIBUTION_TAG;
}

export function attributionDataSuffix(): Hex {
  return toDataSuffix(requireAttributionTag()) as Hex;
}

export async function verifyAttribution(hash: Hex) {
  const client = createCeloPublicClient();
  return verifyTx({ client, hash });
}

export function assertTagPresent(
  decoded: { codes: string[] } | null,
  expected = env.ATTRIBUTION_TAG,
): void {
  if (!expected) return;
  if (!decoded?.codes?.includes(expected)) {
    throw new Error(
      `Attribution tag ${expected} not found on tx (got ${JSON.stringify(decoded)})`,
    );
  }
}
