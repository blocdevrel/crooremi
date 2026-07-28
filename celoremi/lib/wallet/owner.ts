import { getAddress, isAddress, type Address } from "viem";

export function normalizeOwnerAddress(raw: string): Address {
  const trimmed = raw.trim();
  if (!isAddress(trimmed)) {
    throw new Error("Invalid wallet address");
  }
  return getAddress(trimmed);
}

export function policyOwnedBy(
  policy: { ownerAddress: string | null },
  owner: string,
): boolean {
  if (!policy.ownerAddress) return false;
  return (
    policy.ownerAddress.toLowerCase() ===
    normalizeOwnerAddress(owner).toLowerCase()
  );
}
