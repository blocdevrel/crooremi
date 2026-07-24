import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function requireAddress(
  value: string | undefined,
  name: string,
): `0x${string}` {
  const trimmed = value?.trim();
  if (!trimmed || !ADDRESS_RE.test(trimmed)) {
    throw new Error(`${name} must be a valid 0x address in .env`);
  }
  return trimmed as `0x${string}`;
}

export function testRecipientA(): `0x${string}` {
  return requireAddress(process.env.TEST_RECIPIENT_A, "TEST_RECIPIENT_A");
}

export function testRecipientB(): `0x${string}` {
  return requireAddress(process.env.TEST_RECIPIENT_B, "TEST_RECIPIENT_B");
}

export function testEnsName(): string {
  return process.env.TEST_ENS_NAME?.trim() ?? "example.base.eth";
}

export function defaultA2AFundAmount(): string {
  return process.env.A2A_FUND_AMOUNT?.trim() ?? "100000";
}

export function defaultJourneyFundAmount(): string {
  return process.env.JOURNEY_FUND_AMOUNT?.trim() ?? defaultA2AFundAmount();
}

export function splitTestRecipients(): Array<{
  address: `0x${string}`;
  label: string;
  bps: number;
  subname?: string;
}> {
  return [
    { subname: "wallet-a", address: testRecipientA(), label: "wallet-a", bps: 5000 },
    { subname: "wallet-b", address: testRecipientB(), label: "wallet-b", bps: 5000 },
  ];
}
