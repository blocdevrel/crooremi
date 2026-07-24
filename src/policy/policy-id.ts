const POLICY_ID_RE = /pol_[a-f0-9]+/i;

export function extractPolicyId(value: string): string | null {
  const match = value.trim().match(POLICY_ID_RE);
  return match?.[0]?.toLowerCase() ?? null;
}

/** Exact or truncated-prefix match (Agent Store sometimes drops the last hex char). */
export function policyIdMatches(requested: string, candidate: string): boolean {
  const left = requested.trim().toLowerCase();
  const right = candidate.trim().toLowerCase();
  if (left === right) {
    return true;
  }
  if (right.startsWith(left) && left.length >= 12) {
    return true;
  }
  if (left.startsWith(right) && right.length >= 12) {
    return true;
  }
  return false;
}
