export type EnsParentRegistration = {
  parent: string;
  label: string;
  registered: boolean;
  alreadyExisted: boolean;
  txHashes: string[];
  owner: `0x${string}`;
  durationYears: number;
  chain?: "base";
  mock?: boolean;
};

export type SplitRecipient = {
  address: `0x${string}`;
  label: string;
  bps: number;
  ens?: string;
  subname?: string;
};

export type SplitPolicy = {
  id: string;
  name: string;
  recipients: SplitRecipient[];
};

export type EnsSubnameProvision = {
  ens: string;
  address: `0x${string}`;
  created: boolean;
  txHashes: string[];
};

export type CreatePolicyDelivery = {
  policyId: string;
  policy: Omit<SplitPolicy, "id"> & { recipients: SplitRecipient[] };
  allocatedBps: number;
  remainderBps: number;
  remainderNote?: string;
  executionGuide?: ExecutionGuide;
  journeyGuide?: PolicyJourneyGuide;
  ensSubnames?: EnsSubnameProvision[];
  ensParent?: string;
  ensParentRegistration?: EnsParentRegistration;
};

export type ExecuteRequirementsPayroll = {
  policyId: string;
  totalUsdc: string;
};

export type ExecutionPayrollGuide = {
  requirements: ExecuteRequirementsPayroll;
  fundAmount: string;
  fundToken: string;
  serviceFeeUsdc: string;
  estimatedPayUsdc: string;
  recipientCount: number;
  recipients: Array<{
    label: string;
    address: `0x${string}`;
    bps: number;
    amount: string;
  }>;
  note: string;
};

export type ExecutionGuide = {
  totalUsdc: string;
  payroll: ExecutionPayrollGuide;
  remainderBps?: number;
};

export type StoredPolicy = CreatePolicyDelivery & {
  createdAt: string;
};

export type CreateEnsDelivery = {
  org: string;
  orgLabel: string;
  subname?: string;
  ens: string;
  address: `0x${string}`;
  created: boolean;
  txHashes: string[];
  orgRegistration?: EnsParentRegistration;
  baseExplorer?: string;
  mock?: boolean;
};

export type CreateEnsBatchDelivery = {
  org: string;
  orgLabel: string;
  names: CreateEnsDelivery[];
};

export type JourneyNextStep = {
  step: number;
  service: string;
  requirements: Record<string, unknown>;
  note: string;
};

export type EnsJourneyGuide = {
  step: 1;
  flow: "ENS → Policy → Execution";
  nextStep: JourneyNextStep;
};

export type PolicyJourneyGuide = {
  step: 2;
  flow: "ENS → Policy → Execution";
  previousService: "ENS Payout Identity";
  nextService: "USDC Split Execution";
  nextStep?: JourneyNextStep;
  note: string;
};

export type ExecuteBatchInput = {
  policyId: string;
  totalUsdc: string;
  policy?: {
    recipients: Array<{
      address: `0x${string}`;
      label: string;
      bps: number;
    }>;
  };
};

export type ExecuteBatchPlan = {
  policyId: string;
  totalUsdc: string;
  legs: ExecutePayoutLeg[];
  fundAmount: string;
  allocatedBps: number;
  remainderBps: number;
};

export type ExecutePayoutLeg = {
  policyId: string;
  recipient: {
    address: `0x${string}`;
    label: string;
    amount: string;
  };
};

export type ExecutePaymentDelivery = {
  policyId: string;
  totalUsdc: string;
  fundTxHash: string;
  /** Router executeSplit tx when settlement is router_payroll. */
  splitTxHash?: string;
  /** CROO deliverOrder tx — also on `order.deliverTxHash` after completion. */
  deliverTxHash?: string;
  txHashes: string[];
  recipients: Array<{
    label: string;
    address: `0x${string}`;
    amount: string;
    txHash?: string;
  }>;
  baseExplorer: string;
  settlement: "router_payroll" | "wallet_payroll" | "mock_payroll" | "croo_payroll";
};

export type InstantUsdcPayDelivery = {
  success: true;
  to: `0x${string}`;
  toInput: string;
  ens?: string;
  amount: string;
  amountUsdc: string;
  reference?: string;
  fundTxHash: string;
  txHash: string;
  baseExplorer: string;
  settlement: "direct_cap" | "mock_instant_pay";
};
