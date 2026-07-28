import { NextResponse } from "next/server";
import { assertExecuteAuth, AuthError, isSameOriginUi } from "../auth";
import { requireAgentAccount } from "../chain/clients";
import { env, getX402PayTo, isX402Enabled } from "../config";
import { createXPaymentHeader } from "./sign-payment";
import type { PaymentRequirements } from "./types";

export type { PaymentRequirements } from "./types";

export type HireResult = {
  mode: "api_key" | "x402" | "dev_skip";
  settlementTxHash?: string;
};

function facilitatorBase(): string {
  const raw = env.X402_FACILITATOR_URL.replace(/\/$/, "");
  return raw === "https://x402.celo.org" ? "https://api.x402.celo.org" : raw;
}

export function buildHireRequirements(resource: string): PaymentRequirements {
  const payTo = getX402PayTo();
  if (!payTo) {
    throw new Error("X402_PAY_TO (or AGENT_ADDRESS) is required for x402 hires");
  }
  return {
    scheme: "exact",
    network: "celo",
    maxAmountRequired: env.X402_HIRE_PRICE.toString(),
    resource,
    description: "Remifi hire fee",
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: 300,
    asset: env.USDC_ADDRESS,
    extra: { name: "USDC", version: "2" },
  };
}

function paymentRequiredResponse(resource: string) {
  const requirements = buildHireRequirements(resource);
  const body = {
    x402Version: 1,
    error: "Payment required",
    accepts: [requirements],
  };
  return NextResponse.json(body, {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body)).toString("base64"),
    },
  });
}

async function facilitatorPost(
  path: "/verify" | "/settle",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!env.X402_API_KEY) {
    throw new Error("X402_API_KEY is not set");
  }
  const res = await fetch(`${facilitatorBase()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": env.X402_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || json.success === false) {
    const reason =
      (typeof json.errorReason === "string" && json.errorReason) ||
      (typeof json.errorMessage === "string" && json.errorMessage) ||
      (typeof json.error === "string" && json.error) ||
      (json.error && typeof json.error === "object"
        ? JSON.stringify(json.error)
        : undefined) ||
      (typeof json.message === "string" && json.message) ||
      text.slice(0, 300) ||
      `${path} failed (${res.status})`;
    throw new Error(`x402 ${path}: ${reason}`);
  }
  return json;
}

function extractTxHash(settled: Record<string, unknown>): string | undefined {
  const scan = (obj: Record<string, unknown> | undefined): string | undefined => {
    if (!obj) return undefined;
    for (const key of [
      "transaction",
      "txHash",
      "hash",
      "transactionHash",
      "settlementTxHash",
    ]) {
      const c = obj[key];
      if (typeof c === "string" && c.startsWith("0x")) return c;
    }
    return undefined;
  };

  const direct = scan(settled);
  if (direct) return direct;

  for (const nestedKey of ["data", "settlement", "result", "payment"]) {
    const nested = settled[nestedKey];
    if (nested && typeof nested === "object") {
      const found = scan(nested as Record<string, unknown>);
      if (found) return found;
    }
  }
  return undefined;
}

export function buildPaymentResponseHeader(txHash?: string): string | undefined {
  if (!txHash) return undefined;
  const body = {
    success: true,
    transaction: txHash,
    network: "celo",
    errorReason: null,
  };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

/** Settle X-PAYMENT with the Celo facilitator (Track 2). */
export async function settleX402Hire(
  paymentHeader: string,
  requirements: PaymentRequirements,
): Promise<{ txHash?: string; raw?: Record<string, unknown> }> {
  let paymentPayload: unknown = paymentHeader;
  try {
    paymentPayload = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf8"),
    );
  } catch {
    /* keep raw */
  }

  const paymentRequirements = {
    ...requirements,
    network: "celo" as const,
    scheme: "exact" as const,
  };

  const primary = {
    x402Version: 1 as const,
    paymentPayload,
    paymentRequirements,
  };

  const fallbacks: Array<Record<string, unknown>> = [
    { payment: paymentPayload, network: "celo" },
    { x402Version: 1, paymentHeader, paymentRequirements },
  ];

  const isHardFailure = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return /insufficient_funds|invalid_exact|invalid_signature|invalid_network|invalid_payload|expired/i.test(
      msg,
    );
  };

  try {
    const settled = await facilitatorPost("/settle", primary);
    return { txHash: extractTxHash(settled), raw: settled };
  } catch (err) {
    if (isHardFailure(err)) throw err;
    console.warn(
      "[remifi] x402 primary settle failed, trying fallbacks…",
      err instanceof Error ? err.message : err,
    );
  }

  let lastErr: unknown;
  for (const body of fallbacks) {
    try {
      const settled = await facilitatorPost("/settle", body);
      return { txHash: extractTxHash(settled), raw: settled };
    } catch (err) {
      lastErr = err;
      if (isHardFailure(err)) throw err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("x402 settle failed for all payload shapes");
}

/** Agent-signed hire when the caller did not attach X-PAYMENT. */
export async function settleAgentSignedHire(
  resource: string,
): Promise<HireResult> {
  const account = requireAgentAccount();
  const requirements = buildHireRequirements(resource);
  const { header } = await createXPaymentHeader(account, requirements);
  const settled = await settleX402Hire(header, requirements);
  return {
    mode: "x402",
    ...(settled.txHash ? { settlementTxHash: settled.txHash } : {}),
  };
}

/**
 * Gate `/api/pay` + `/api/execute`:
 * x402 hire (caller header or agent-signed) then tagged payout.
 */
export async function requireHirePayment(
  req: Request,
  resource: string,
): Promise<HireResult | NextResponse> {
  if (env.DEV_SKIP_X402 || !isX402Enabled()) {
    try {
      assertExecuteAuth(req as import("next/server").NextRequest);
      return { mode: env.DEV_SKIP_X402 ? "dev_skip" : "api_key" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unauthorized";
      return NextResponse.json({ error: message }, { status: 401 });
    }
  }

  const payTo = getX402PayTo();
  if (!payTo || !env.X402_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Set X402_API_KEY + X402_PAY_TO (Track 2) — required for full Remifi hire flow",
      },
      { status: 503 },
    );
  }

  const payment =
    req.headers.get("x-payment") || req.headers.get("PAYMENT-SIGNATURE");

  if (payment) {
    try {
      const requirements = buildHireRequirements(resource);
      const settled = await settleX402Hire(payment, requirements);
      return {
        mode: "x402",
        ...(settled.txHash ? { settlementTxHash: settled.txHash } : {}),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "x402 settlement failed";
      console.error("[remifi] x402 settle error", message);
      return NextResponse.json({ error: message }, { status: 402 });
    }
  }

  let authorized = isSameOriginUi(req);
  if (!authorized) {
    try {
      assertExecuteAuth(req as import("next/server").NextRequest);
      authorized = true;
    } catch (err) {
      if (!(err instanceof AuthError)) {
        const message = err instanceof Error ? err.message : "Unauthorized";
        return NextResponse.json({ error: message }, { status: 401 });
      }
    }
  }

  if (!authorized) {
    return paymentRequiredResponse(resource);
  }

  try {
    return await settleAgentSignedHire(resource);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "x402 agent hire failed";
    console.error("[remifi] x402 agent hire error", message);
    return NextResponse.json({ error: message }, { status: 402 });
  }
}

export function isHireResult(
  value: HireResult | NextResponse,
): value is HireResult {
  return !(value instanceof NextResponse);
}

/**
 * Wallet-settlement routes: caller must attach X-PAYMENT (never agent-signed hire).
 */
export async function requireUserHirePayment(
  req: Request,
  resource: string,
): Promise<HireResult | NextResponse> {
  if (env.DEV_SKIP_X402 || !isX402Enabled()) {
    try {
      assertExecuteAuth(req as import("next/server").NextRequest);
      return { mode: env.DEV_SKIP_X402 ? "dev_skip" : "api_key" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unauthorized";
      return NextResponse.json({ error: message }, { status: 401 });
    }
  }

  const payTo = getX402PayTo();
  if (!payTo || !env.X402_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Set X402_API_KEY + X402_PAY_TO (Track 2) — required for Remifi hire flow",
      },
      { status: 503 },
    );
  }

  const payment =
    req.headers.get("x-payment") || req.headers.get("PAYMENT-SIGNATURE");

  if (!payment) {
    return paymentRequiredResponse(resource);
  }

  try {
    const requirements = buildHireRequirements(resource);
    const settled = await settleX402Hire(payment, requirements);
    return {
      mode: "x402",
      ...(settled.txHash ? { settlementTxHash: settled.txHash } : {}),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "x402 settlement failed";
    console.error("[remifi] x402 user hire error", message);
    return NextResponse.json({ error: message }, { status: 402 });
  }
}
