import { resolveRecipientAddresses } from "../ens/resolve";
import {
  hasLlmKeys,
  interpretPolicyText,
  llmRequiredError,
  renormalizeBpsToTotal,
} from "./llm";
import { validateRecipients, type PolicyRecipient } from "./validate";

export type InterpretedPolicy = {
  name: string;
  recipients: PolicyRecipient[];
  source: "json" | "text";
  /** Original ENS / Base names before resolution, when present */
  resolvedFrom?: Array<{ input: string; address: `0x${string}`; ens?: string }>;
};

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapNaturalLanguage(asJson: unknown): string | null {
  if (!asJson || typeof asJson !== "object" || Array.isArray(asJson)) {
    return null;
  }
  const o = asJson as Record<string, unknown>;
  for (const key of ["text", "prompt", "instructions", "description"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function fromDraft(
  name: string,
  recipients: Array<{ address: string; bps: number; label?: string }>,
  source: "json" | "text",
): Promise<InterpretedPolicy> {
  const scaled = renormalizeBpsToTotal(recipients);
  const resolved = await resolveRecipientAddresses(scaled);
  const validated = validateRecipients(
    resolved.map((r) => ({
      address: r.address,
      bps: r.bps,
      ...(r.label ? { label: r.label } : {}),
    })),
  );

  return {
    name,
    recipients: validated,
    source,
    resolvedFrom: resolved.map((r, i) => ({
      input: scaled[i]!.address,
      address: r.address,
      ...(r.ens ? { ens: r.ens } : {}),
    })),
  };
}

function resolvePolicyName(userName?: string, fallback?: string): string {
  const fromUser = userName?.trim();
  if (fromUser) return fromUser;
  const fromFallback = fallback?.trim();
  if (fromFallback) return fromFallback;
  return "Split policy";
}

/**
 * Remifi-style policy intake: plain English via Anthropic, or JSON recipients.
 * User-supplied `name` from the UI always wins over LLM/JSON suggestions.
 * ENS / Base names are resolved before validate.
 */
export async function interpretPolicyFromInput(input: {
  text?: string;
  name?: string;
  recipients?: Array<{ address: string; bps: number; label?: string }>;
}): Promise<InterpretedPolicy> {
  const text = input.text?.trim();

  if (text) {
    const asJson = tryParseJson(text);
    if (asJson && typeof asJson === "object" && !Array.isArray(asJson)) {
      const o = asJson as Record<string, unknown>;
      if (Array.isArray(o.recipients)) {
        return fromDraft(
          resolvePolicyName(
            input.name,
            typeof o.name === "string" ? o.name : undefined,
          ),
          o.recipients as Array<{ address: string; bps: number; label?: string }>,
          "json",
        );
      }
      const nested = unwrapNaturalLanguage(asJson);
      if (nested) {
        return interpretPolicyFromInput({ text: nested, name: input.name });
      }
    }

    if (!hasLlmKeys()) {
      throw new Error(llmRequiredError("createPolicy"));
    }
    const draft = await interpretPolicyText(text);
    return fromDraft(
      resolvePolicyName(input.name, draft.name),
      draft.recipients,
      "text",
    );
  }

  if (input.recipients?.length) {
    return fromDraft(
      resolvePolicyName(input.name),
      input.recipients,
      "json",
    );
  }

  throw new Error(
    'Provide plain English in { "text": "..." } or JSON { "recipients": [...] }',
  );
}
