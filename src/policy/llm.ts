import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import { env } from "../config.js";
import { BPS_TOTAL } from "./bps.js";
import { hasLlmKeys, llmRequiredError } from "./requirements-utils.js";

const llmPolicySchema = z.object({
  name: z.string().describe("Short human-readable policy name"),
  org: z
    .string()
    .optional()
    .describe(
      "User's org label for Base names (e.g. acme → acme.base.eth). Required when using subnames.",
    ),
  recipients: z
    .array(
      z.object({
        address: z
          .string()
          .describe("Recipient 0x address or Base name (e.g. alice.base.eth)"),
        label: z.string().describe("Role label: team, ops, treasury, etc."),
        subname: z
          .string()
          .optional()
          .describe(
            "Optional ENS sublabel under the user's org (e.g. payroll → payroll.acme.base.eth)",
          ),
        bps: z
          .number()
          .int()
          .positive()
          .describe(
            "Basis points for this recipient only. 30% = 3000 bps. Do not pad to fill 100%.",
          ),
      }),
    )
    .min(1),
});

export type LlmPolicyDraft = z.infer<typeof llmPolicySchema>;

const llmExecuteSchema = z.object({
  policyId: z
    .string()
    .describe("Policy ID from createPolicy delivery, e.g. pol_a1b2c3"),
  totalUsdc: z
    .string()
    .regex(/^\d+$/)
    .describe(
      "Total payroll principal in 6-decimal USDC base units. 1.00 USDC = 1000000.",
    ),
});

export type LlmExecuteDraft = z.infer<typeof llmExecuteSchema>;

const llmCreateEnsNameSchema = z.object({
  org: z.string().describe("Org label for Base name, e.g. acme → acme.base.eth"),
  address: z
    .string()
    .optional()
    .describe("0x address or Base name to set as resolver for subname/org"),
  subname: z
    .string()
    .optional()
    .describe("Optional sublabel, e.g. payroll → payroll.acme.base.eth"),
  names: z
    .array(
      z.object({
        subname: z.string(),
        address: z.string(),
      }),
    )
    .optional()
    .describe("Batch mode — multiple subnames under the same org"),
});

export type LlmCreateEnsDraft = z.infer<typeof llmCreateEnsNameSchema>;

const llmEnsResolveSchema = z.object({
  queries: z
    .array(
      z.object({
        value: z.string().describe("ENS name (e.g. vitalik.eth) or 0x address"),
        direction: z
          .enum(["forward", "reverse"])
          .optional()
          .describe("forward for name→address, reverse for address→name; infer if omitted"),
      }),
    )
    .min(1)
    .max(10),
});

export type LlmEnsResolveDraft = z.infer<typeof llmEnsResolveSchema>;

const llmInstantUsdcPaySchema = z.object({
  to: z
    .string()
    .describe("Recipient 0x address or Base name (*.base.eth)"),
  amount: z
    .string()
    .regex(/^\d+$/)
    .describe("USDC amount in 6-decimal base units. 0.50 USDC = 500000"),
  reference: z
    .string()
    .optional()
    .describe("Optional payment memo or invoice reference"),
});

export type LlmInstantUsdcPayDraft = z.infer<typeof llmInstantUsdcPaySchema>;

function createAnthropicModel(): BaseChatModel {
  return new ChatAnthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    temperature: 0,
    maxRetries: 2,
  });
}

function createOpenAiModel(): BaseChatModel {
  return new ChatOpenAI({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    maxRetries: 2,
  });
}

function getBaseModel(): BaseChatModel {
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicModel();
  }
  if (env.OPENAI_API_KEY) {
    return createOpenAiModel();
  }
  throw new Error(llmRequiredError("Remifi"));
}

async function runStructuredChain<T extends z.ZodTypeAny>(
  schema: T,
  name: string,
  systemPrompt: string,
  requirements: string,
): Promise<z.infer<T>> {
  const structuredModel = getBaseModel().withStructuredOutput(schema, {
    name,
    method: "jsonSchema",
  });
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    ["human", "{requirements}"],
  ]);
  const chain = prompt.pipe(structuredModel);
  const result = await chain.invoke({ requirements });
  return schema.parse(result);
}

const policySystemPrompt = `You convert payment split instructions into structured split policies.

Rules:
- Express each recipient share as basis points (bps). 100% = ${BPS_TOTAL} bps. 30% = 3000 bps.
- Use the percentages the user stated — do NOT renormalize to 100% if they gave partial shares.
  Example: "30% and 60%" → 3000 bps and 6000 bps (10% / 1000 bps stays unallocated).
- If the user gives ratios without % (e.g. "3:2"), treat as proportional shares of 100%.
- If shares would exceed 100%, scale down proportionally and mention it in the policy name.
- Keep addresses exactly as given (0x hex or Base names like alice.base.eth).
- Optional org: user's basename label (e.g. acme → names under acme.base.eth).
- Optional subname: short label under that org (e.g. payroll → payroll.acme.base.eth).
- Use concise labels (team, ops, treasury, wallet-a, etc.).
- Input may be plain English, Agent Store Text, or JSON — interpret intent and fill missing labels.
- When input is JSON with recipients[], preserve addresses and convert percent/bps fields correctly.
- If totalUsdc appears in JSON, use it only as context for naming — do not output totalUsdc.`;

const executeSystemPrompt = `You convert payroll execution requests into structured executePaymentJob input.

Rules:
- policyId must be copied exactly from createPolicy delivery (pol_ + hex).
- totalUsdc is the payroll principal in 6-decimal USDC units (1000000 = 1.00 USDC).
- Convert dollar amounts: $1 = 1000000, $0.10 = 100000, $10 = 10000000.
- "Run payroll", "execute split", "pay everyone on policy X" → extract policyId + amount.
- If amount is missing, use 1000000 (1 USDC) as default example amount.
- Input may be plain English, partial JSON, or Agent Store text wrappers.`;

const createEnsSystemPrompt = `You convert Base name registration requests into structured createEnsName input.

Rules:
- org is the user's org label (acme → acme.base.eth on Base).
- subname creates payroll.acme.base.eth when combined with org.
- address is the 0x wallet or resolvable Base name for the subname.
- Batch: use names[] when user lists multiple subnames under one org.
- Base Names only (*.base.eth) — not L1 .eth registration.
- Input may be plain English or messy JSON — interpret intent.`;

const ensResolveSystemPrompt = `You convert ENS lookup requests into forward/reverse resolver queries.

Rules:
- forward: ENS name → 0x address (e.g. vitalik.eth, payroll.acme.base.eth).
- reverse: 0x address → primary name.
- Infer direction: hex 0x… = reverse; *.eth names = forward.
- Support multiple lookups in one request (max 10).
- Input may be plain text, comma-separated names, or JSON wrappers.`;

const instantUsdcPaySystemPrompt = `You convert instant USDC payment requests into structured pay instructions.

Rules:
- to: recipient 0x address or Base name (*.base.eth). Resolve names as given — do not invent addresses.
- amount: USDC in 6-decimal base units only (500000 = 0.50 USDC, 1000000 = 1 USDC).
- Convert dollar amounts: $1 = 1000000, $0.10 = 100000, $10 = 10000000.
- reference: optional memo, invoice id, or note if user mentions one.
- "Send X USDC to Y", "Pay Y X dollars", "Transfer 0.5 USDC to alice.base.eth" → extract to + amount.
- Input may be plain English, Agent Store Text, or JSON — interpret intent.`;

export async function interpretPolicyText(
  requirements: string,
): Promise<LlmPolicyDraft> {
  if (!hasLlmKeys()) {
    throw new Error(llmRequiredError("createPolicy"));
  }
  return runStructuredChain(
    llmPolicySchema,
    "SplitPolicy",
    policySystemPrompt,
    requirements,
  );
}

export async function interpretExecutePayrollText(
  requirements: string,
): Promise<LlmExecuteDraft> {
  if (!hasLlmKeys()) {
    throw new Error(llmRequiredError("executePaymentJob"));
  }
  return runStructuredChain(
    llmExecuteSchema,
    "ExecutePayroll",
    executeSystemPrompt,
    requirements,
  );
}

export async function interpretCreateEnsText(
  requirements: string,
): Promise<LlmCreateEnsDraft> {
  if (!hasLlmKeys()) {
    throw new Error(llmRequiredError("createEnsName"));
  }
  return runStructuredChain(
    llmCreateEnsNameSchema,
    "CreateEnsName",
    createEnsSystemPrompt,
    requirements,
  );
}

export async function interpretEnsResolveText(
  requirements: string,
): Promise<LlmEnsResolveDraft> {
  if (!hasLlmKeys()) {
    throw new Error(llmRequiredError("resolveEnsName"));
  }
  return runStructuredChain(
    llmEnsResolveSchema,
    "EnsResolve",
    ensResolveSystemPrompt,
    requirements,
  );
}

export async function interpretInstantUsdcPayText(
  requirements: string,
): Promise<LlmInstantUsdcPayDraft> {
  if (!hasLlmKeys()) {
    throw new Error(llmRequiredError("Instant USDC Pay"));
  }
  return runStructuredChain(
    llmInstantUsdcPaySchema,
    "InstantUsdcPay",
    instantUsdcPaySystemPrompt,
    requirements,
  );
}
