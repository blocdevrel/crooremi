import { z } from "zod";
import { baseExplorerTx, env } from "../config.js";
import { ensureUserOrg, resolveUserOrg } from "./ens-org.js";
import { ensureSubname } from "./ens-subnames.js";
import { resolveAddressInput } from "./ens.js";
import { interpretCreateEnsText, type LlmCreateEnsDraft } from "./llm.js";
import {
  hasLlmKeys,
  llmRequiredError,
  tryParseJson,
  unwrapNaturalLanguage,
} from "./requirements-utils.js";
import type { CreateEnsDelivery } from "./types.js";

const subnameEntrySchema = z.object({
  subname: z.string().min(1),
  address: z.string().min(1),
});

const createEnsSchema = z.object({
  org: z.string().min(1),
  address: z.string().min(1),
  subname: z.string().min(1).optional(),
});

const createEnsBatchSchema = z.object({
  org: z.string().min(1),
  names: z.array(subnameEntrySchema).min(1),
});

async function provisionFromLlmDraft(
  draft: LlmCreateEnsDraft,
): Promise<CreateEnsDelivery | { org: string; orgLabel: string; names: CreateEnsDelivery[] }> {
  const { label, domain } = resolveUserOrg(draft.org);
  const orgRegistration = await ensureUserOrg(draft.org);

  if (draft.names && draft.names.length > 0) {
    const names: CreateEnsDelivery[] = [];
    for (const item of draft.names) {
      names.push(
        await provisionSubname(domain, label, item.subname, item.address, orgRegistration),
      );
    }
    return { org: domain, orgLabel: label, names };
  }

  if (!draft.address) {
    throw new Error("createEnsName requires an address for the org or subname");
  }

  if (!draft.subname) {
    return provisionOrgRoot(domain, label, draft.address, orgRegistration);
  }

  return provisionSubname(domain, label, draft.subname, draft.address, orgRegistration);
}

/**
 * createEnsName — user org (e.g. acme → acme.base.eth) + optional subnames.
 * LangChain interprets plain text and messy JSON when AI keys are configured.
 */
export async function createEnsFromRequirements(
  requirements: string,
): Promise<CreateEnsDelivery | { org: string; orgLabel: string; names: CreateEnsDelivery[] }> {
  const trimmed = requirements.trim();
  if (!trimmed) {
    throw new Error("createEnsName requirements cannot be empty");
  }

  const asJson = tryParseJson(trimmed);

  if (asJson === null) {
    return provisionFromLlmDraft(await interpretCreateEnsText(trimmed));
  }

  const naturalLanguage = unwrapNaturalLanguage(asJson);
  if (naturalLanguage !== null) {
    return provisionFromLlmDraft(await interpretCreateEnsText(naturalLanguage));
  }

  if (hasLlmKeys()) {
    return provisionFromLlmDraft(await interpretCreateEnsText(trimmed));
  }

  if (createEnsBatchSchema.safeParse(asJson).success) {
    const batch = createEnsBatchSchema.parse(asJson);
    const { label, domain } = resolveUserOrg(batch.org);
    const orgRegistration = await ensureUserOrg(batch.org);
    const names: CreateEnsDelivery[] = [];
    for (const item of batch.names) {
      names.push(
        await provisionSubname(domain, label, item.subname, item.address, orgRegistration),
      );
    }
    return { org: domain, orgLabel: label, names };
  }

  if (createEnsSchema.safeParse(asJson).success) {
    const single = createEnsSchema.parse(asJson);
    const { label, domain } = resolveUserOrg(single.org);
    const orgRegistration = await ensureUserOrg(single.org);

    if (!single.subname) {
      return provisionOrgRoot(domain, label, single.address, orgRegistration);
    }

    return provisionSubname(domain, label, single.subname, single.address, orgRegistration);
  }

  throw new Error(
    `${llmRequiredError("createEnsName")} Expected { "org": "acme", "subname": "payroll", "address": "0x..." }.`,
  );
}

async function provisionOrgRoot(
  domain: string,
  orgLabel: string,
  addressInput: string,
  orgRegistration: Awaited<ReturnType<typeof ensureUserOrg>>,
): Promise<CreateEnsDelivery> {
  const { address } = await resolveAddressInput(addressInput);
  const txHash = orgRegistration.txHashes[0];

  return {
    org: domain,
    orgLabel,
    ens: domain,
    address,
    created: orgRegistration.registered,
    txHashes: orgRegistration.txHashes,
    orgRegistration,
    baseExplorer: txHash ? baseExplorerTx(txHash) : undefined,
    mock: env.DEV_MOCK_ENS_SUBNAMES || undefined,
  };
}

async function provisionSubname(
  domain: string,
  orgLabel: string,
  subname: string,
  addressInput: string,
  orgRegistration: Awaited<ReturnType<typeof ensureUserOrg>>,
): Promise<CreateEnsDelivery> {
  const { address } = await resolveAddressInput(addressInput);
  const result = await ensureSubname(subname, domain, address);
  const txHash = result.txHashes[0] ?? orgRegistration.txHashes[0];

  return {
    org: domain,
    orgLabel,
    subname,
    ens: result.ens,
    address: result.address,
    created: result.created,
    txHashes: [...orgRegistration.txHashes, ...result.txHashes],
    orgRegistration,
    baseExplorer: txHash ? baseExplorerTx(txHash) : undefined,
    mock: env.DEV_MOCK_ENS_SUBNAMES || undefined,
  };
}
