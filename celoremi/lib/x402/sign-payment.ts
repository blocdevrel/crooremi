import { getAddress, type Hex, type PrivateKeyAccount } from "viem";
import type { PaymentRequirements } from "./types";

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

export type ExactEvmPayload = {
  signature: Hex;
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
  };
};

export type PaymentPayloadV1 = {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: ExactEvmPayload;
};

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Sign EIP-3009 hire fee; returns base64 X-PAYMENT header. */
export async function createXPaymentHeader(
  account: PrivateKeyAccount,
  requirements: PaymentRequirements,
): Promise<{ header: string; payload: PaymentPayloadV1 }> {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: getAddress(account.address),
    to: getAddress(requirements.payTo),
    value: requirements.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + (requirements.maxTimeoutSeconds || 300)),
    nonce: randomNonce(),
  };

  const signature = await account.signTypedData({
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

  const payload: PaymentPayloadV1 = {
    x402Version: 1,
    scheme: "exact",
    network: requirements.network,
    payload: {
      signature,
      authorization,
    },
  };

  const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return { header, payload };
}
