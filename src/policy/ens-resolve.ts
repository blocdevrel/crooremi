import { createPublicClient, http, isAddress } from "viem";
import { normalize } from "viem/ens";
import { base, mainnet } from "viem/chains";
import { z } from "zod";
import { env } from "../config.js";
import { getBasenameRegistryOwner } from "./ens-register-base.js";
import { interpretEnsResolveText } from "./llm.js";
import { hasLlmKeys, tryParseJson } from "./requirements-utils.js";

const MAX_QUERIES = 10;

const baseEnsClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL),
});

const mainnetEnsClient = createPublicClient({
  chain: mainnet,
  transport: http(env.ETH_RPC_URL),
});

export type EnsResolveChain = "base" | "ethereum";
export type EnsResolveDirection = "forward" | "reverse";

export type EnsLookupResult = {
  input: string;
  direction: EnsResolveDirection;
  name?: string;
  address?: string;
  chain: EnsResolveChain;
  resolved: boolean;
  error?: string;
};

export type EnsResolveDelivery = {
  success: boolean;
  results: EnsLookupResult[];
  /** Set when the buyer sent a single name or address. */
  input?: string;
  direction?: EnsResolveDirection;
  name?: string;
  address?: string;
  chain?: EnsResolveChain;
};

type NormalizedQuery = {
  direction: EnsResolveDirection;
  value: string;
};

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/i.test(value.trim());
}

function normalizeHexAddress(value: string): `0x${string}` {
  return value.trim().toLowerCase() as `0x${string}`;
}

function isBasename(value: string): boolean {
  return value.toLowerCase().endsWith(".base.eth");
}

function isEnsName(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.endsWith(".eth") || (v.includes(".") && !isHexAddress(v));
}

function queryFromPlainText(value: string): NormalizedQuery[] {
  const v = value.trim();
  if (!v) {
    throw new Error("ENS lookup cannot be empty");
  }
  if (isHexAddress(v)) {
    return [{ direction: "reverse", value: normalizeHexAddress(v) }];
  }
  if (isEnsName(v)) {
    return [{ direction: "forward", value: v }];
  }
  throw new Error(
    "Enter an ENS name like blockdevrel.base.eth or vitalik.eth, or a 0x address",
  );
}

function unwrapTextPayload(asJson: unknown): string | null {
  if (typeof asJson === "string") {
    const trimmed = asJson.trim();
    return trimmed || null;
  }
  if (!asJson || typeof asJson !== "object" || Array.isArray(asJson)) {
    return null;
  }
  for (const key of ["text", "input", "query", "name", "address"] as const) {
    const value = (asJson as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function parseMaybeJsonArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    const parsed = tryParseJson(value.trim());
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  }
  return undefined;
}

const queryItemSchema = z
  .object({
    name: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  })
  .refine((item) => item.name !== undefined || item.address !== undefined, {
    message: "Each query needs name or address",
  });

const requirementsSchema = z.object({
  text: z.string().min(1).optional(),
  input: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  queries: z.union([z.array(queryItemSchema), z.string()]).optional(),
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  forward: z.union([z.array(z.string()), z.string()]).optional(),
  reverse: z.union([z.array(z.string()), z.string()]).optional(),
});

function parseEnsResolveQueriesStrict(requirements: string): NormalizedQuery[] {
  const trimmed = requirements.trim();
  if (!trimmed) {
    throw new Error("ENS resolver requirements cannot be empty");
  }

  const asJson = tryParseJson(trimmed);
  if (asJson === null) {
    return queryFromPlainText(trimmed);
  }

  const plain = unwrapTextPayload(asJson);
  if (plain) {
    return queryFromPlainText(plain);
  }

  const parsed = requirementsSchema.safeParse(asJson);
  if (!parsed.success) {
    throw new Error(
      "Enter an ENS name like blockdevrel.base.eth or vitalik.eth, or a 0x address",
    );
  }

  const input = parsed.data;
  const queries: NormalizedQuery[] = [];

  if (input.text) {
    queries.push(...queryFromPlainText(input.text));
  }
  if (input.input) {
    queries.push(...queryFromPlainText(input.input));
  }
  if (input.query) {
    queries.push(...queryFromPlainText(input.query));
  }

  const queryItems = Array.isArray(input.queries)
    ? input.queries
    : input.queries
      ? (tryParseJson(String(input.queries)) as z.infer<typeof queryItemSchema>[] | null)
      : null;

  if (queryItems) {
    for (const item of queryItems) {
      const row = queryItemSchema.parse(item);
      if (row.name) {
        queries.push({ direction: "forward", value: row.name.trim() });
      } else if (row.address) {
        queries.push({
          direction: "reverse",
          value: normalizeHexAddress(row.address),
        });
      }
    }
  }

  if (input.name) {
    queries.push({ direction: "forward", value: input.name.trim() });
  }

  if (input.address) {
    queries.push({
      direction: "reverse",
      value: normalizeHexAddress(input.address),
    });
  }

  for (const name of parseMaybeJsonArray(input.forward) ?? []) {
    queries.push({ direction: "forward", value: name.trim() });
  }

  for (const address of parseMaybeJsonArray(input.reverse) ?? []) {
    queries.push({
      direction: "reverse",
      value: normalizeHexAddress(address),
    });
  }

  if (queries.length === 0) {
    throw new Error(
      "Enter an ENS name like blockdevrel.base.eth or vitalik.eth, or a 0x address",
    );
  }

  if (queries.length > MAX_QUERIES) {
    throw new Error(`ENS resolver accepts at most ${MAX_QUERIES} lookups per hire`);
  }

  return queries;
}

async function parseEnsResolveWithLlm(requirements: string): Promise<NormalizedQuery[]> {
  const draft = await interpretEnsResolveText(requirements);
  const queries = draft.queries.map((query) => {
    const value = query.value.trim();
    const direction =
      query.direction ??
      (isHexAddress(value) ? ("reverse" as const) : ("forward" as const));
    return {
      direction,
      value: direction === "reverse" ? normalizeHexAddress(value) : value,
    };
  });

  if (queries.length > MAX_QUERIES) {
    throw new Error(`ENS resolver accepts at most ${MAX_QUERIES} lookups per hire`);
  }

  return queries;
}

export async function parseEnsResolveQueries(
  requirements: string,
): Promise<NormalizedQuery[]> {
  try {
    return parseEnsResolveQueriesStrict(requirements);
  } catch (strictError) {
    if (!hasLlmKeys()) {
      throw strictError;
    }
    try {
      return await parseEnsResolveWithLlm(requirements);
    } catch {
      throw strictError;
    }
  }
}

async function forwardResolveName(name: string): Promise<EnsLookupResult> {
  const input = name.trim();
  const chain: EnsResolveChain = isBasename(input) ? "base" : "ethereum";

  try {
    const normalized = normalize(input);

    if (chain === "base") {
      const address = await baseEnsClient
        .getEnsAddress({ name: normalized })
        .catch(() => null);

      if (address) {
        return {
          input,
          direction: "forward",
          name: input,
          address,
          chain,
          resolved: true,
        };
      }

      const registryOwner = await getBasenameRegistryOwner(normalized);
      if (registryOwner) {
        return {
          input,
          direction: "forward",
          name: input,
          address: registryOwner,
          chain,
          resolved: true,
        };
      }

      return {
        input,
        direction: "forward",
        chain,
        resolved: false,
        error: `Base name not found: ${input}`,
      };
    }

    const address = await mainnetEnsClient
      .getEnsAddress({ name: normalized })
      .catch(() => null);

    if (address) {
      return {
        input,
        direction: "forward",
        name: input,
        address,
        chain,
        resolved: true,
      };
    }

    return {
      input,
      direction: "forward",
      chain,
      resolved: false,
      error: `ENS name not found: ${input}`,
    };
  } catch (err) {
    return {
      input,
      direction: "forward",
      chain,
      resolved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function reverseResolveInput(addressInput: string): Promise<EnsLookupResult> {
  const input = normalizeHexAddress(addressInput);

  if (!isAddress(input)) {
    return {
      input: addressInput,
      direction: "reverse",
      chain: "base",
      resolved: false,
      error: `Invalid address: ${addressInput}`,
    };
  }

  try {
    const baseName = await baseEnsClient
      .getEnsName({ address: input })
      .catch(() => null);

    if (baseName) {
      return {
        input,
        direction: "reverse",
        name: baseName,
        address: input,
        chain: "base",
        resolved: true,
      };
    }

    const ethName = await mainnetEnsClient
      .getEnsName({ address: input })
      .catch(() => null);

    if (ethName) {
      return {
        input,
        direction: "reverse",
        name: ethName,
        address: input,
        chain: "ethereum",
        resolved: true,
      };
    }

    return {
      input,
      direction: "reverse",
      chain: "ethereum",
      resolved: false,
      error: "No primary ENS name found for this address",
    };
  } catch (err) {
    return {
      input,
      direction: "reverse",
      chain: "ethereum",
      resolved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function resolveEnsFromRequirements(
  requirements: string,
): Promise<EnsResolveDelivery> {
  const queries = await parseEnsResolveQueries(requirements);
  const results: EnsLookupResult[] = [];

  for (const query of queries) {
    if (query.direction === "forward") {
      if (!isEnsName(query.value)) {
        results.push({
          input: query.value,
          direction: "forward",
          chain: "base",
          resolved: false,
          error: "Forward lookup requires an ENS name",
        });
        continue;
      }
      results.push(await forwardResolveName(query.value));
      continue;
    }

    results.push(await reverseResolveInput(query.value));
  }

  return {
    success: results.every((row) => row.resolved),
    results,
    ...(results.length === 1
      ? {
          input: results[0]!.input,
          direction: results[0]!.direction,
          ...(results[0]!.name ? { name: results[0]!.name } : {}),
          ...(results[0]!.address ? { address: results[0]!.address } : {}),
          chain: results[0]!.chain,
        }
      : {}),
  };
}
