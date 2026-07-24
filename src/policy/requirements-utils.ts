import { env } from "../config.js";

export const NL_JSON_KEYS = [
  "text",
  "requirements",
  "input",
  "prompt",
  "message",
] as const;

export function hasLlmKeys(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
}

export function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Agent Store often wraps NL in Schema JSON — unwrap before structured parse. */
export function unwrapNaturalLanguage(json: unknown): string | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }

  const record = json as Record<string, unknown>;
  if (
    record.policy ||
    record.recipients ||
    record.org ||
    record.names ||
    (record.policyId && record.totalUsdc)
  ) {
    return null;
  }

  for (const key of NL_JSON_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function llmRequiredError(service: string): string {
  return (
    `${service} smart parsing requires ANTHROPIC_API_KEY or OPENAI_API_KEY in .env. ` +
    "Send machine-readable JSON or add an AI key."
  );
}
