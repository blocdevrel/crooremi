import { DEFAULT_GUIDE_TOTAL_USDC } from "./execution-guide.js";
import type {
  CreateEnsBatchDelivery,
  CreateEnsDelivery,
  CreatePolicyDelivery,
  EnsJourneyGuide,
  PolicyJourneyGuide,
} from "./types.js";

type EnsNameEntry = {
  subname?: string;
  ens: string;
  address: `0x${string}`;
};

function extractEnsNames(
  delivery: CreateEnsDelivery | CreateEnsBatchDelivery,
): { orgLabel: string; names: EnsNameEntry[] } {
  if ("names" in delivery) {
    return {
      orgLabel: delivery.orgLabel,
      names: delivery.names.map((n) => ({
        subname: n.subname,
        ens: n.ens,
        address: n.address,
      })),
    };
  }

  return {
    orgLabel: delivery.orgLabel,
    names: [
      {
        subname: delivery.subname,
        ens: delivery.ens,
        address: delivery.address,
      },
    ],
  };
}

/** Equal bps template when building policy requirements from ENS-only delivery. */
function defaultBpsSplit(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(10_000 / count);
  const remainder = 10_000 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? remainder : 0));
}

export function buildPolicyRequirementsFromEns(
  delivery: CreateEnsDelivery | CreateEnsBatchDelivery,
  options: {
    totalUsdc?: string;
    bps?: number[];
    name?: string;
  } = {},
): Record<string, unknown> {
  const { orgLabel, names } = extractEnsNames(delivery);
  const totalUsdc = options.totalUsdc ?? DEFAULT_GUIDE_TOTAL_USDC;
  const bpsList = options.bps ?? defaultBpsSplit(names.length);

  const recipients = names.map((entry, index) => {
    const label = entry.subname ?? `recipient-${index + 1}`;
    return {
      subname: entry.subname ?? label,
      address: entry.address,
      label,
      bps: bpsList[index] ?? defaultBpsSplit(names.length)[index],
    };
  });

  return {
    org: orgLabel,
    totalUsdc,
    name: options.name ?? `${orgLabel} split`,
    recipients,
  };
}

export function attachEnsJourneyGuide(
  delivery: CreateEnsDelivery | CreateEnsBatchDelivery,
  totalUsdc: string = DEFAULT_GUIDE_TOTAL_USDC,
): Record<string, unknown> & { journeyGuide: EnsJourneyGuide } {
  const policyRequirements = buildPolicyRequirementsFromEns(delivery, { totalUsdc });

  return {
    ...delivery,
    journeyGuide: {
      step: 1,
      flow: "ENS → Policy → Execution",
      nextStep: {
        step: 2,
        service: "USDC Split Policy",
        requirements: policyRequirements,
        note:
          "Hire USDC Split Policy with this JSON. Adjust bps if needed, then use " +
          "executionGuide.payroll for step 3.",
      },
    },
  };
}

export function attachPolicyJourneyGuide(
  delivery: CreatePolicyDelivery,
): PolicyJourneyGuide {
  const hasEns = Boolean(
    delivery.ensSubnames?.length ||
      delivery.policy.recipients.some((r) => r.ens || r.subname),
  );

  return {
    step: 2,
    flow: "ENS → Policy → Execution",
    previousService: "ENS Payout Identity",
    nextService: "USDC Split Execution",
    ...(delivery.executionGuide
      ? {
          nextStep: {
            step: 3,
            service: "USDC Split Execution",
            requirements: delivery.executionGuide.payroll.requirements,
            note:
              "Hire USDC Split Execution once. Set fund amount to " +
              "executionGuide.payroll.fundAmount and fund token to Base USDC.",
          },
        }
      : {}),
    note: hasEns
      ? "ENS names are linked. Run payroll execution (step 3) once for all recipients."
      : "Run payroll execution (step 3) once — executionGuide.payroll has the JSON.",
  };
}
