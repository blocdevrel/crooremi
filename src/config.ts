import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const envPath = resolve(repoRoot, ".env");
if (existsSync(envPath)) {
  loadEnv({ path: envPath, override: false });
}

const envSchema = z.object({
  CROO_API_URL: z.string().url().default("https://api.croo.network"),
  CROO_WS_URL: z.string().url().default("wss://api.croo.network/ws"),
  CROO_SDK_KEY: z.string().min(1, "CROO_SDK_KEY is required"),
  CROO_SERVICE_ID_CREATE_POLICY: z.string().optional(),
  CROO_SERVICE_ID_EXECUTE_PAYMENT: z.string().optional(),
  CROO_SERVICE_ID_CREATE_ENS: z.string().optional(),
  CROO_SERVICE_ID_RESOLVE_ENS: z.string().optional(),
  CROO_SERVICE_ID_INSTANT_USDC_PAY: z.string().optional(),
  CROO_REQUESTER_SDK_KEY: z.string().optional(),
  CROO_AGENT_ID: z
    .string()
    .uuid()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  REMIFI_AGENT_STORE_URL: z
    .string()
    .url()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  ETH_RPC_URL: z.string().url().default("https://ethereum.publicnode.com"),
  BASE_CHAIN_ID: z.coerce.number().default(8453),
  USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ENS_REGISTRAR_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value : undefined)),
  PROVIDER_PAYOUT_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value : undefined)),
  ROUTER_ADDRESS: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  ROUTER_EXECUTOR_ADDRESS: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  DEV_MOCK_PAYROLL_SETTLEMENT: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  DEV_MOCK_ENS_SUBNAMES: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  ENS_AUTO_REGISTER_PARENT: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  ENS_REGISTRATION_YEARS: z.coerce.number().int().min(1).max(10).default(1),
  PROVIDER_AA_WALLET_ADDRESS: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined)),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${message}`);
  }
  return parsed.data;
}

export const env = parseEnv();

export function isCreateEnsService(serviceId: string): boolean {
  return Boolean(
    env.CROO_SERVICE_ID_CREATE_ENS &&
      serviceId === env.CROO_SERVICE_ID_CREATE_ENS,
  );
}

export function isExecutePaymentService(serviceId: string): boolean {
  return Boolean(
    env.CROO_SERVICE_ID_EXECUTE_PAYMENT &&
      serviceId === env.CROO_SERVICE_ID_EXECUTE_PAYMENT,
  );
}

export function isCreatePolicyService(serviceId: string): boolean {
  return Boolean(
    env.CROO_SERVICE_ID_CREATE_POLICY &&
      serviceId === env.CROO_SERVICE_ID_CREATE_POLICY,
  );
}

export function isResolveEnsService(serviceId: string): boolean {
  return Boolean(
    env.CROO_SERVICE_ID_RESOLVE_ENS &&
      serviceId === env.CROO_SERVICE_ID_RESOLVE_ENS,
  );
}

export function isInstantUsdcPayService(serviceId: string): boolean {
  return Boolean(
    env.CROO_SERVICE_ID_INSTANT_USDC_PAY &&
      serviceId === env.CROO_SERVICE_ID_INSTANT_USDC_PAY,
  );
}

export const baseExplorerTx = (txHash: string) =>
  env.BASE_CHAIN_ID === 8453
    ? `https://basescan.org/tx/${txHash}`
    : `https://sepolia.basescan.org/tx/${txHash}`;

export function getAgentStoreUrl(): string {
  if (env.REMIFI_AGENT_STORE_URL) {
    return env.REMIFI_AGENT_STORE_URL;
  }
  if (env.CROO_AGENT_ID) {
    return `https://agent.croo.network/agents/${env.CROO_AGENT_ID}`;
  }
  return "https://agent.croo.network";
}
