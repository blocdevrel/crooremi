import { z } from "zod";
import { resolveAddressInput } from "./ens.js";
import { interpretInstantUsdcPayText } from "./llm.js";
import {
  hasLlmKeys,
  llmRequiredError,
  tryParseJson,
  unwrapNaturalLanguage,
} from "./requirements-utils.js";
import {
  isEvmAddress,
  parseAgentStoreInstantPayRequirements,
} from "./store-requirements.js";

export type InstantUsdcPayInput = {
  to: string;
  amount: string;
  reference?: string;
};

export type InstantUsdcPayResolved = InstantUsdcPayInput & {
  address: `0x${string}`;
  ens?: string;
};

export type InstantUsdcPayParseContext = {
  fundAmount?: string;
  /** Accept negotiation only needs recipient — amount comes from order fundAmount at delivery. */
  recipientOnly?: boolean;
};

const instantPayJsonSchema = z.object({
  to: z.string().min(1).optional(),
  send: z.string().min(1).optional(),
  recipient: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  totalUsdc: z.union([z.string(), z.number()]).optional(),
  principal_amount: z.union([z.string(), z.number()]).optional(),
  principalAmount: z.union([z.string(), z.number()]).optional(),
  reference: z.string().optional(),
  memo: z.string().optional(),
});

function parseUsdcAmount(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    if (Number.isInteger(value) && value >= 1000) {
      return String(value);
    }
    return String(Math.round(value * 1_000_000));
  }
  return null;
}

function extractFromNaturalLanguage(text: string): InstantUsdcPayInput | null {
  const sendTo = text.match(
    /send\s+(\d+(?:\.\d+)?)\s*usdc\s+to\s+(.+)/i,
  );
  if (sendTo) {
    const amount = parseUsdcAmount(Number.parseFloat(sendTo[1]!));
    const to = sendTo[2]!.trim().replace(/[.\s]+$/, "");
    if (amount && to) {
      return { to, amount };
    }
  }

  const toSend = text.match(
    /send\s+(.+?)\s+(\d+(?:\.\d+)?)\s*usdc/i,
  );
  if (toSend) {
    const amount = parseUsdcAmount(Number.parseFloat(toSend[2]!));
    const to = toSend[1]!.trim();
    if (amount && to) {
      return { to, amount };
    }
  }

  return null;
}

function mergeAmount(
  parsed: Partial<InstantUsdcPayInput>,
  ctx?: InstantUsdcPayParseContext,
): string | null {
  return (
    (parsed.amount ? parseUsdcAmount(parsed.amount) : null) ??
    (ctx?.fundAmount?.trim() ? parseUsdcAmount(ctx.fundAmount.trim()) : null)
  );
}

function finalizeInstantPayInput(
  partial: { to: string; amount?: string; reference?: string },
  ctx: InstantUsdcPayParseContext,
): InstantUsdcPayInput {
  const amount = mergeAmount(partial, ctx);
  if (!amount && !ctx.recipientOnly) {
    throw new Error(
      "Instant USDC Pay could not determine amount — set principal in checkout or include amount in requirements",
    );
  }
  return {
    to: partial.to.trim(),
    amount: amount ?? "0",
    reference: partial.reference,
  };
}

export async function parseInstantUsdcPayRequirements(
  requirements: string,
  ctx: InstantUsdcPayParseContext = {},
): Promise<InstantUsdcPayInput> {
  const trimmed = requirements.trim();
  if (!trimmed) {
    throw new Error("Instant USDC Pay requires recipient address");
  }

  const asJson = tryParseJson(trimmed);

  // Store UI (fund transfer ON): principal in checkout, recipient only in requirements
  if (asJson === null) {
    if (isEvmAddress(trimmed)) {
      return finalizeInstantPayInput({ to: trimmed }, ctx);
    }
    if (ctx.fundAmount) {
      const fromFund = parseUsdcAmount(ctx.fundAmount);
      if (fromFund && !trimmed.startsWith("{")) {
        return { to: trimmed, amount: fromFund };
      }
    }
  }

  if (asJson !== null && typeof asJson === "object" && !Array.isArray(asJson)) {
    const naturalLanguage = unwrapNaturalLanguage(asJson);
    if (naturalLanguage) {
      return parseInstantUsdcPayRequirements(naturalLanguage, ctx);
    }

    const fromStore = parseAgentStoreInstantPayRequirements(asJson, {
      fundAmount: ctx.fundAmount,
    });
    if (fromStore) {
      return finalizeInstantPayInput(fromStore, ctx);
    }

    const record = instantPayJsonSchema.parse(asJson);
    const to = record.to ?? record.send ?? record.recipient ?? record.address;
    if (to) {
      return finalizeInstantPayInput(
        {
          to,
          amount:
            parseUsdcAmount(record.amount) ??
            parseUsdcAmount(record.totalUsdc) ??
            parseUsdcAmount(record.principal_amount) ??
            parseUsdcAmount(record.principalAmount) ??
            undefined,
          reference: record.reference ?? record.memo,
        },
        ctx,
      );
    }
  }

  const fromText = extractFromNaturalLanguage(trimmed);
  if (fromText) {
    return fromText;
  }

  if (hasLlmKeys()) {
    const draft = await interpretInstantUsdcPayText(trimmed);
    const amount = parseUsdcAmount(draft.amount) ?? mergeAmount({}, ctx);
    if (!amount) {
      throw new Error("Instant USDC Pay could not determine amount");
    }
    return {
      to: draft.to.trim(),
      amount,
      reference: draft.reference,
    };
  }

  throw new Error(
    `${llmRequiredError("Instant USDC Pay")} ` +
      'Expected JSON like { "to": "0x...", "amount": "500000" } or ' +
      '"Send 0.50 USDC to 0x...".',
  );
}

export async function resolveInstantUsdcPay(
  input: InstantUsdcPayInput,
): Promise<InstantUsdcPayResolved> {
  const { address, ens } = await resolveAddressInput(input.to);
  return {
    ...input,
    address,
    ens: input.to.includes(".") ? input.to.trim() : ens,
  };
}

export async function resolveInstantPayFundAddress(
  requirements: string,
  ctx: InstantUsdcPayParseContext = {},
): Promise<`0x${string}`> {
  const parsed = await parseInstantUsdcPayRequirements(requirements, {
    ...ctx,
    recipientOnly: true,
  });
  const resolved = await resolveInstantUsdcPay(parsed);
  console.log("[remifi] instant USDC pay accept →", {
    to: resolved.address,
    ens: resolved.ens,
    amount: resolved.amount,
  });
  return resolved.address;
}
