import { z } from "zod";

const emptyToUndef = (v: string | undefined) =>
  v && v.trim() !== "" ? v.trim() : undefined;

const envSchema = z.object({
  ATTRIBUTION_TAG: z
    .string()
    .optional()
    .transform((v) => {
      const tag = emptyToUndef(v);
      if (!tag) return undefined;
      if (!/^celo_[a-z0-9_]+$/.test(tag)) {
        throw new Error("ATTRIBUTION_TAG must look like celo_xxxxxxxxxxxx");
      }
      return tag;
    }),
  AGENT_PRIVATE_KEY: z.string().optional().transform(emptyToUndef),
  AGENT_ADDRESS: z
    .string()
    .optional()
    .transform((v) => {
      const addr = emptyToUndef(v);
      if (!addr) return undefined;
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        throw new Error("AGENT_ADDRESS must be a 0x address");
      }
      return addr;
    }),
  CELO_RPC_URL: z.string().url().default("https://forno.celo.org"),
  CELO_CHAIN_ID: z.coerce.number().default(42220),
  USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
  DATABASE_URL: z.string().optional().transform(emptyToUndef),
  EXECUTE_API_KEY: z.string().optional().transform(emptyToUndef),
  X402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://api.x402.celo.org"),
  X402_API_KEY: z.string().optional().transform(emptyToUndef),
  X402_PAY_TO: z
    .string()
    .optional()
    .transform((v) => {
      const addr = emptyToUndef(v);
      if (!addr) return undefined;
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        throw new Error("X402_PAY_TO must be a 0x address");
      }
      return addr;
    }),
  X402_HIRE_PRICE: z.coerce.bigint().default(10_000n),
  ROUTER_ADDRESS: z
    .string()
    .optional()
    .transform((v) => {
      const addr = emptyToUndef(v);
      if (!addr) return undefined;
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        throw new Error("ROUTER_ADDRESS must be a 0x address");
      }
      return addr;
    }),
  MAX_AMOUNT_PER_JOB: z.coerce.bigint().default(1_000_000_000n),
  MAX_DAILY_AMOUNT: z.coerce.bigint().default(10_000_000_000n),
  MIN_AMOUNT: z.coerce.bigint().default(10_000n),
  DEV_MOCK_PAYOUT: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  DEV_SKIP_X402: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ANTHROPIC_API_KEY: z.string().optional().transform(emptyToUndef),
  ANTHROPIC_MODEL: z
    .string()
    .optional()
    .transform((v) => emptyToUndef(v) ?? "claude-haiku-4-5-20251001"),
  /** Ethereum L1 RPC for ENS (*.eth) resolution — avoid flaky llamarpc defaults */
  ETH_RPC_URL: z.string().url().default("https://ethereum.publicnode.com"),
  /** Base RPC for Base Names (*.base.eth) resolution */
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${message}`);
  }
  return parsed.data;
}

export const env = parseEnv();

export const CELOSCAN_TX = (hash: string) => `https://celoscan.io/tx/${hash}`;

export const USDC_DECIMALS = 6;

export function getX402PayTo(): `0x${string}` | undefined {
  if (env.X402_PAY_TO) return env.X402_PAY_TO as `0x${string}`;
  if (env.AGENT_ADDRESS) return env.AGENT_ADDRESS as `0x${string}`;
  return undefined;
}

export function isX402Enabled(): boolean {
  if (env.DEV_SKIP_X402) return false;
  return Boolean(env.X402_API_KEY && getX402PayTo());
}
