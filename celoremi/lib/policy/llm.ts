import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../config";
import { BPS_TOTAL } from "./validate";

const llmPolicySchema = z.object({
  name: z.string().describe("Short human-readable policy name"),
  recipients: z
    .array(
      z.object({
        address: z
          .string()
          .describe(
            "Recipient 0x address, ENS name (vitalik.eth), or Base name (alice.base.eth)",
          ),
        label: z.string().describe("Role label: ops, growth, treasury, etc."),
        bps: z
          .number()
          .int()
          .positive()
          .describe(
            `Basis points. 100% = ${BPS_TOTAL}. 30% = 3000. Prefer shares that sum to ${BPS_TOTAL}.`,
          ),
      }),
    )
    .min(1)
    .max(20),
});

export type LlmPolicyDraft = z.infer<typeof llmPolicySchema>;

export function hasLlmKeys(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function llmRequiredError(service: string): string {
  return `${service} needs natural-language interpretation — set ANTHROPIC_API_KEY`;
}

const policySystemPrompt = `You convert payment split instructions into structured USDC split policies for Remifi (Remifi on Celo).

Rules:
- Express each recipient share as basis points (bps). 100% = ${BPS_TOTAL} bps. 30% = 3000 bps.
- Prefer shares that sum exactly to ${BPS_TOTAL}. If the user gives ratios (e.g. "3:2"), convert to proportional bps of ${BPS_TOTAL}.
- If the user gives partial percents (e.g. 30% and 60%), keep those bps and leave the remainder unallocated — do not invent a third recipient.
- Keep addresses/names exactly as given (0x hex, ENS like vitalik.eth, or Base names like alice.base.eth).
- Use concise labels (ops, growth, treasury, alice, etc.).
- Input may be plain English or messy JSON — interpret intent and fill missing labels.
- Settlement is on Celo USDC; ENS/Base names are identity only.
- Respond with ONLY valid JSON matching the schema. No markdown.`;

/**
 * Plain-English (or messy JSON) → split policy draft via Anthropic.
 */
export async function interpretPolicyText(
  requirements: string,
): Promise<LlmPolicyDraft> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(llmRequiredError("createPolicy"));
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: 0,
    system: policySystemPrompt,
    messages: [
      {
        role: "user",
        content: `Convert this into a split policy JSON object with keys name and recipients[{address,label,bps}]:\n\n${requirements}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Anthropic returned no policy JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]!);
  } catch {
    throw new Error("Anthropic returned invalid policy JSON");
  }

  return llmPolicySchema.parse(parsed);
}

/** Scale recipient bps so they sum to BPS_TOTAL (remainder on last). */
export function renormalizeBpsToTotal<
  T extends { bps: number },
>(recipients: T[]): T[] {
  const sum = recipients.reduce((a, r) => a + r.bps, 0);
  if (sum === BPS_TOTAL) return recipients;
  if (sum <= 0) {
    throw new Error("Recipient bps sum must be > 0");
  }

  let allocated = 0;
  return recipients.map((r, i) => {
    const isLast = i === recipients.length - 1;
    const bps = isLast
      ? BPS_TOTAL - allocated
      : Math.floor((r.bps * BPS_TOTAL) / sum);
    allocated += bps;
    return { ...r, bps };
  });
}
