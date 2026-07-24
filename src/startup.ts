import { env } from "./config.js";

type RequiredInProd = {
  key: keyof typeof env;
  hint: string;
};

const PRODUCTION_REQUIRED: RequiredInProd[] = [
  {
    key: "CROO_SERVICE_ID_CREATE_POLICY",
    hint: "Agent Store → createPolicy service ID",
  },
  {
    key: "CROO_SERVICE_ID_EXECUTE_PAYMENT",
    hint: "Agent Store → executePaymentJob service ID",
  },
  {
    key: "CROO_SERVICE_ID_CREATE_ENS",
    hint: "Agent Store → createEnsName service ID",
  },
  {
    key: "CROO_SERVICE_ID_RESOLVE_ENS",
    hint: "Agent Store → ENS Forward & Reverse Resolver service ID",
  },
  {
    key: "CROO_SERVICE_ID_INSTANT_USDC_PAY",
    hint: "Agent Store → Instant USDC Pay service ID",
  },
  {
    key: "ENS_REGISTRAR_PRIVATE_KEY",
    hint: "Operator wallet — pays ENS registration gas on Base",
  },
];

function hasPayoutSigningKey(): boolean {
  return Boolean(
    env.PROVIDER_PAYOUT_PRIVATE_KEY?.trim() || env.ENS_REGISTRAR_PRIVATE_KEY?.trim(),
  );
}

export function validateStartup(): void {
  if (env.NODE_ENV !== "production") {
    console.log(`[remifi] starting in ${env.NODE_ENV} mode`);
    if (!env.DATABASE_URL && env.CROO_SERVICE_ID_EXECUTE_PAYMENT) {
      console.warn(
        "[remifi] WARNING: DATABASE_URL unset — fund-transfer orders require Postgres order ledger",
      );
    }
    if (!env.DATABASE_URL && env.CROO_SERVICE_ID_INSTANT_USDC_PAY) {
      console.warn(
        "[remifi] WARNING: DATABASE_URL unset — instantUsdcPay requires Postgres order ledger",
      );
    }
    return;
  }

  const errors: string[] = [];

  if (env.DEV_MOCK_ENS_SUBNAMES) {
    errors.push("DEV_MOCK_ENS_SUBNAMES must be false in production");
  }

  for (const { key, hint } of PRODUCTION_REQUIRED) {
    const value = env[key];
    if (value === undefined || value === null || value === "") {
      errors.push(`${key} is required (${hint})`);
    }
  }

  if (!env.DATABASE_URL) {
    errors.push("DATABASE_URL is required (Neon Postgres — policy store for execution)");
  }

  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    errors.push(
      "ANTHROPIC_API_KEY or OPENAI_API_KEY is required (LangChain smart parsing on all services)",
    );
  }

  if (!hasPayoutSigningKey()) {
    errors.push(
      "PROVIDER_PAYOUT_PRIVATE_KEY (or ENS_REGISTRAR_PRIVATE_KEY) is required to call Router / sign payouts",
    );
  }

  if (env.ROUTER_ADDRESS && !env.DEV_MOCK_PAYROLL_SETTLEMENT) {
    if (!env.ROUTER_ADDRESS.match(/^0x[a-fA-F0-9]{40}$/)) {
      errors.push("ROUTER_ADDRESS must be a valid 0x address");
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Production startup blocked:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  console.log("[remifi] production env validated");
}

export function registerProcessHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    console.error("[remifi] unhandled rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[remifi] uncaught exception:", err);
    process.exit(1);
  });
}
