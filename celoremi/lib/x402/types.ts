export type PaymentRequirements = {
  scheme: "exact";
  network: "celo" | "eip155:42220";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
};

export type PaymentRequiredBody = {
  x402Version?: number;
  error?: string;
  accepts?: PaymentRequirements[];
};
