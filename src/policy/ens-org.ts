import { normalize } from "viem/ens";
import { env } from "../config.js";
import { parseBasenameLabel, registerBasenameParent, getBasenameRegistryOwner } from "./ens-register-base.js";
import { resolveAddressInput } from "./ens.js";
import type { EnsParentRegistration } from "./types.js";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function resolveUserOrg(orgInput: string): { label: string; domain: string } {
  const trimmed = orgInput.trim().toLowerCase();

  if (trimmed.endsWith(".base.eth")) {
    const label = trimmed.slice(0, -".base.eth".length);
    if (!label || label.includes(".") || !LABEL_RE.test(label)) {
      throw new Error(`Invalid org domain "${orgInput}"`);
    }
    return { label, domain: normalize(trimmed) };
  }

  if (trimmed.endsWith(".eth")) {
    throw new Error(
      `L1 .eth names are not supported. Use a Base org label (e.g. acme → acme.base.eth).`,
    );
  }

  if (!LABEL_RE.test(trimmed)) {
    throw new Error(
      `Invalid org label "${orgInput}". Use lowercase letters, numbers, hyphens (e.g. acme).`,
    );
  }

  return { label: trimmed, domain: normalize(`${trimmed}.base.eth`) };
}

export function isOrgRegistrationEnabled(): boolean {
  return Boolean(
    env.ENS_AUTO_REGISTER_PARENT &&
      (env.DEV_MOCK_ENS_SUBNAMES || env.ENS_REGISTRAR_PRIVATE_KEY),
  );
}

export function canProvisionEns(): boolean {
  return Boolean(env.DEV_MOCK_ENS_SUBNAMES || env.ENS_REGISTRAR_PRIVATE_KEY);
}

async function registerOrgDomain(orgDomain: string): Promise<EnsParentRegistration> {
  if (!parseBasenameLabel(orgDomain)) {
    throw new Error(`Org must be a Base name (*.base.eth), got ${orgDomain}`);
  }
  console.log(`[remifi] registering basename ${orgDomain}…`);
  return registerBasenameParent(orgDomain);
}

export async function ensureUserOrg(orgInput: string): Promise<EnsParentRegistration> {
  if (!canProvisionEns()) {
    throw new Error(
      "ENS_REGISTRAR_PRIVATE_KEY required — Remifi operator wallet pays ETH on Base; users pay USDC via CAP",
    );
  }

  const { label, domain } = resolveUserOrg(orgInput);

  try {
    const existing = await resolveAddressInput(domain);
    if (existing.address) {
      return {
        parent: domain,
        label,
        registered: false,
        alreadyExisted: true,
        txHashes: [],
        owner: existing.address,
        durationYears: env.ENS_REGISTRATION_YEARS,
        chain: "base",
      };
    }
  } catch {
    // no forward addr — check registry
  }

  const registryOwner = await getBasenameRegistryOwner(domain);
  if (registryOwner) {
    return {
      parent: domain,
      label,
      registered: false,
      alreadyExisted: true,
      txHashes: [],
      owner: registryOwner,
      durationYears: env.ENS_REGISTRATION_YEARS,
      chain: "base",
    };
  }

  return registerOrgDomain(domain);
}

export async function ensureOrgParent(
  orgDomain: string,
): Promise<EnsParentRegistration | null> {
  if (!isOrgRegistrationEnabled()) {
    return null;
  }
  return ensureUserOrg(orgDomain);
}
