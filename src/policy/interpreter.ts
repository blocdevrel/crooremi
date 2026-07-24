import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  formatRemainderNote,
  percentToBps,
  validateBps,
} from "./bps.js";
import { ensureUserOrg, resolveUserOrg, canProvisionEns } from "./ens-org.js";
import { resolveRecipients } from "./ens.js";
import { provisionPolicySubnames } from "./ens-subnames.js";
import {
  buildExecutionGuide,
  DEFAULT_GUIDE_TOTAL_USDC,
} from "./execution-guide.js";
import { interpretPolicyText } from "./llm.js";
import {
  hasLlmKeys,
  llmRequiredError,
  tryParseJson,
  unwrapNaturalLanguage,
} from "./requirements-utils.js";
import type {
  CreatePolicyDelivery,
} from "./types.js";

type PolicyDraft = {
  name: string;
  org?: string;
  ensParent?: string;
  recipients: Array<{
    address: string;
    label: string;
    bps: number;
    ens?: string;
    subname?: string;
  }>;
};

const addressOrEnsSchema = z.string().min(1);

const recipientSchema = z
  .object({
    address: addressOrEnsSchema,
    label: z.string().min(1),
    bps: z.number().int().positive().optional(),
    percent: z.union([z.number().positive(), z.string().min(1)]).optional(),
    ens: z.string().optional(),
    subname: z.string().optional(),
  })
  .transform((recipient) => {
    let bps = recipient.bps;
    if (bps === undefined && recipient.percent !== undefined) {
      const raw =
        typeof recipient.percent === "string"
          ? recipient.percent.replace(/%/g, "").trim()
          : recipient.percent;
      const pct = typeof raw === "number" ? raw : Number.parseFloat(raw);
      if (!Number.isFinite(pct) || pct <= 0) {
        throw new Error(`Invalid percent for recipient "${recipient.label}"`);
      }
      bps = percentToBps(pct);
    }
    if (!bps) {
      throw new Error(
        `Recipient "${recipient.label}" must include bps or percent`,
      );
    }
    return { ...recipient, bps };
  });

const policyBodySchema = z.object({
  name: z.string().min(1),
  org: z.string().optional(),
  ensParent: z.string().optional(),
  recipients: z.array(recipientSchema).min(1),
});

const createPolicyJsonSchema = z.object({
  name: z.string().min(1).optional(),
  org: z.string().optional(),
  ensParent: z.string().optional(),
  totalUsdc: z.string().regex(/^\d+$/).optional(),
  policy: policyBodySchema.optional(),
  recipients: z.array(recipientSchema).min(1).optional(),
});

function extractGuideTotalUsdc(raw: string): string {
  const asJson = tryParseJson(raw);
  if (asJson === null || typeof asJson !== "object" || asJson === null) {
    return DEFAULT_GUIDE_TOTAL_USDC;
  }
  const record = asJson as Record<string, unknown>;
  const total = record.totalUsdc;
  if (typeof total === "string" && /^\d+$/.test(total)) {
    return total;
  }
  return DEFAULT_GUIDE_TOTAL_USDC;
}

function newPolicyId(): string {
  return `pol_${randomBytes(6).toString("hex")}`;
}

function resolvePolicyOrgDomain(draft: PolicyDraft): string | undefined {
  if (draft.ensParent) {
    return draft.ensParent.includes(".") ? draft.ensParent : resolveUserOrg(draft.ensParent).domain;
  }
  if (draft.org) {
    return resolveUserOrg(draft.org).domain;
  }
  return undefined;
}

function normalizePolicyBody(
  input: z.infer<typeof createPolicyJsonSchema>,
): PolicyDraft {
  if (input.policy) {
    validateBps(input.policy.recipients);
    return input.policy;
  }

  if (input.recipients) {
    validateBps(input.recipients);
    return {
      name: input.name ?? "Split policy",
      org: input.org,
      ensParent: input.ensParent,
      recipients: input.recipients,
    };
  }

  throw new Error(
    "Policy JSON must include policy or recipients. " +
      "For natural language, use Text requirements or { \"text\": \"...\" }.",
  );
}

/**
 * Machine-readable JSON fallback when no AI keys are configured.
 */
function isMachineStructuredPolicy(json: unknown): boolean {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return false;
  }

  const record = json as Record<string, unknown>;
  const policy = record.policy as Record<string, unknown> | undefined;
  const recipients = (record.recipients ?? policy?.recipients) as unknown;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return false;
  }

  return recipients.every((item) => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const rec = item as Record<string, unknown>;
    return (
      typeof rec.address === "string" &&
      typeof rec.label === "string" &&
      (rec.bps !== undefined || rec.percent !== undefined)
    );
  });
}

async function parseStructuredPolicy(
  json: unknown,
  guideTotalUsdc: string,
): Promise<CreatePolicyDelivery> {
  const parsed = createPolicyJsonSchema.parse(json);
  const policy = normalizePolicyBody(parsed);
  return finalizePolicy(policy, guideTotalUsdc);
}

async function interpretNaturalLanguage(
  text: string,
  guideTotalUsdc: string,
): Promise<CreatePolicyDelivery> {
  if (!hasLlmKeys()) {
    throw new Error(llmRequiredError("createPolicy"));
  }

  const draft = await interpretPolicyText(text);
  return finalizePolicy(draft, guideTotalUsdc);
}

async function finalizePolicy(
  draft: PolicyDraft,
  guideTotalUsdc: string = DEFAULT_GUIDE_TOTAL_USDC,
): Promise<CreatePolicyDelivery> {
  const { allocatedBps, remainderBps } = validateBps(draft.recipients);
  let recipients = await resolveRecipients(draft.recipients);

  const parentDomain = resolvePolicyOrgDomain(draft);
  const hasSubnames = draft.recipients.some((r) => r.subname);
  let ensSubnames: CreatePolicyDelivery["ensSubnames"];
  let ensParentRegistration: CreatePolicyDelivery["ensParentRegistration"];

  if (parentDomain && hasSubnames && canProvisionEns()) {
    ensParentRegistration = await ensureUserOrg(
      draft.org ?? draft.ensParent ?? parentDomain,
    );
    const withSubnames = recipients.map((r, i) => ({
      ...r,
      subname: draft.recipients[i]?.subname,
    }));
    const provisioned = await provisionPolicySubnames(withSubnames, parentDomain);
    recipients = provisioned.recipients;
    ensSubnames = provisioned.ensSubnames;
    ensParentRegistration = provisioned.ensParentRegistration ?? undefined;
  }

  const delivery: CreatePolicyDelivery = {
    policyId: newPolicyId(),
    policy: {
      name: draft.name,
      recipients,
    },
    allocatedBps,
    remainderBps,
    ...(remainderBps > 0
      ? { remainderNote: formatRemainderNote(remainderBps) }
      : {}),
    ...(ensSubnames?.length ? { ensSubnames, ensParent: parentDomain } : {}),
    ...(ensParentRegistration ? { ensParentRegistration } : {}),
  };

  delivery.executionGuide = buildExecutionGuide(delivery, guideTotalUsdc);
  return delivery;
}

export async function interpretPolicyFromRequirements(
  requirements: string,
): Promise<CreatePolicyDelivery> {
  const trimmed = requirements.trim();
  if (!trimmed) {
    throw new Error("createPolicy requirements cannot be empty");
  }

  const guideTotalUsdc = extractGuideTotalUsdc(trimmed);
  const asJson = tryParseJson(trimmed);

  if (asJson === null) {
    return interpretNaturalLanguage(trimmed, guideTotalUsdc);
  }

  const naturalLanguage = unwrapNaturalLanguage(asJson);
  if (naturalLanguage !== null) {
    return interpretNaturalLanguage(naturalLanguage, guideTotalUsdc);
  }

  // LangChain-first when AI keys are configured — interprets JSON, partial JSON, and intent.
  if (hasLlmKeys()) {
    return interpretNaturalLanguage(trimmed, guideTotalUsdc);
  }

  if (isMachineStructuredPolicy(asJson)) {
    return parseStructuredPolicy(asJson, guideTotalUsdc);
  }

  try {
    return await parseStructuredPolicy(asJson, guideTotalUsdc);
  } catch (structuredError) {
    const hint =
      structuredError instanceof Error ? structuredError.message : String(structuredError);
    throw new Error(`${hint} ${llmRequiredError("createPolicy")}`);
  }
}
