"use client";

import { getAddress, type Address, type Hex, type WalletClient } from "viem";
import { ensureCeloChain } from "../minipay/connect";
import type { PaymentRequirements, PaymentRequiredBody } from "./types";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function buildClientHireRequirements(input: {
  resource: string;
  payTo: string;
  hirePrice: string;
  usdcAddress: string;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "celo",
    maxAmountRequired: input.hirePrice,
    resource: input.resource,
    description: "Remifi hire fee",
    mimeType: "application/json",
    payTo: input.payTo,
    maxTimeoutSeconds: 300,
    asset: input.usdcAddress,
    extra: { name: "USDC", version: "2" },
  };
}

export function parsePaymentRequired(
  res: Response,
  body?: PaymentRequiredBody | null,
): PaymentRequirements | null {
  const header =
    res.headers.get("payment-required") ??
    res.headers.get("PAYMENT-REQUIRED");
  if (header) {
    try {
      const decoded = JSON.parse(
        atob(header.replace(/-/g, "+").replace(/_/g, "/")),
      ) as PaymentRequiredBody;
      if (decoded.accepts?.[0]) return decoded.accepts[0];
    } catch {
      /* ignore */
    }
  }
  if (body?.accepts?.[0]) return body.accepts[0];
  return null;
}

/** Sign EIP-3009 hire fee with the connected browser / MiniPay wallet. */
export async function createBrowserXPaymentHeader(
  client: WalletClient,
  account: Address,
  requirements: PaymentRequirements,
): Promise<string> {
  await ensureCeloChain();

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: getAddress(account),
    to: getAddress(requirements.payTo),
    value: requirements.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + (requirements.maxTimeoutSeconds || 300)),
    nonce: randomNonce(),
  };

  const signature = await client.signTypedData({
    account,
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId: 42220,
      verifyingContract: getAddress(requirements.asset),
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const payload = {
    x402Version: 1,
    scheme: "exact" as const,
    network: requirements.network,
    payload: {
      signature,
      authorization,
    },
  };

  return btoa(JSON.stringify(payload));
}

/**
 * POST with optional wallet-signed X-PAYMENT (Track 2).
 * When a wallet is connected, signs the hire fee up front so every Pay / Execute settles x402.
 */
export async function fetchWithX402Hire(
  url: string,
  init: RequestInit,
  wallet: { client: WalletClient; account: Address } | null,
  hireConfig?: {
    resource: string;
    payTo: string;
    hirePrice: string;
    usdcAddress: string;
  } | null,
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (wallet && hireConfig?.payTo) {
    const requirements = buildClientHireRequirements({
      resource: hireConfig.resource,
      payTo: hireConfig.payTo,
      hirePrice: hireConfig.hirePrice,
      usdcAddress: hireConfig.usdcAddress,
    });
    const paymentHeader = await createBrowserXPaymentHeader(
      wallet.client,
      wallet.account,
      requirements,
    );
    headers.set("X-PAYMENT", paymentHeader);
  }

  const res = await fetch(url, { ...init, headers });

  if (res.status !== 402 || !wallet) return res;

  let body: PaymentRequiredBody | null = null;
  try {
    body = (await res.clone().json()) as PaymentRequiredBody;
  } catch {
    body = null;
  }

  const requirements = parsePaymentRequired(res, body);
  if (!requirements) return res;

  const paymentHeader = await createBrowserXPaymentHeader(
    wallet.client,
    wallet.account,
    requirements,
  );
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("X-PAYMENT", paymentHeader);
  if (!retryHeaders.has("content-type")) {
    retryHeaders.set("content-type", "application/json");
  }

  return fetch(url, { ...init, headers: retryHeaders });
}
