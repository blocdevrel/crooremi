"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { usdcDecimalForInput } from "../../lib/minipay/balance";
import {
  isMiniPayRuntime,
  isMobileDevice,
  openInMiniPay,
} from "../../lib/minipay/connect";
import { fetchWithX402Hire } from "../../lib/x402/browser";
import { useMiniPayWallet } from "../hooks/useMiniPayWallet";

type Tab = "home" | "split" | "pay" | "status";
type ProofFilter = "all" | "sends" | "splits" | "x402";

type Health = {
  ok: boolean;
  agentAddress: string | null;
  usdcBalance: string | null;
  usdcBalanceFormatted: string | null;
  usdc?: string;
  chainOk: boolean;
  mockPayout: boolean;
  payrollMode: string;
  attributionTagConfigured: boolean;
  x402: {
    enabled: boolean;
    payTo: string | null;
    hirePrice: string;
    facilitatorOk: boolean | null;
  };
  router: { configured: boolean; ok?: boolean };
};

type SavedPolicy = {
  policyId: string;
  name: string | null;
  recipients: Array<{ address: string; bps: number; label?: string }>;
  createdAt?: string;
  updatedAt?: string;
};

function shortAddr(a: string | null | undefined) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function normalizePolicy(raw: unknown): SavedPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const policyId = String(row.policyId ?? row.id ?? "").trim();
  if (!policyId) return null;

  const rawRecipients = row.recipients;
  const recipients = Array.isArray(rawRecipients)
    ? rawRecipients
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const r = entry as Record<string, unknown>;
          const address = String(r.address ?? "").trim();
          const bps = Number(r.bps);
          if (!address || !Number.isFinite(bps) || bps <= 0) return null;
          return {
            address,
            bps,
            ...(typeof r.label === "string" && r.label.trim()
              ? { label: r.label.trim() }
              : {}),
          };
        })
        .filter(Boolean) as SavedPolicy["recipients"]
    : [];

  return {
    policyId,
    name: typeof row.name === "string" ? row.name : null,
    recipients,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : typeof row.createdAt === "string"
          ? row.createdAt
          : undefined,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : typeof row.updatedAt === "string"
          ? row.updatedAt
          : undefined,
  };
}

function sortPoliciesNewestFirst(policies: SavedPolicy[]) {
  return [...policies].sort((a, b) => {
    const aTs = a.updatedAt ?? a.createdAt ?? "";
    const bTs = b.updatedAt ?? b.createdAt ?? "";
    return bTs.localeCompare(aTs);
  });
}

function summarizePolicyRecipients(
  recipients: Array<{ address: string; bps: number; label?: string }>,
  short = shortAddr,
) {
  return recipients
    .map((r) => {
      const pct = r.bps % 100 === 0 ? String(r.bps / 100) : (r.bps / 100).toFixed(1);
      const who = r.label?.trim() || short(r.address);
      return `${who} ${pct}%`;
    })
    .join(" · ");
}

function policyMatchesSearch(policy: SavedPolicy, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    policy.name ?? "",
    policy.policyId,
    summarizePolicyRecipients(policy.recipients, (a) => a ?? ""),
    ...policy.recipients.flatMap((r) => [r.address, r.label ?? ""]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

type JobResult = {
  jobId?: string;
  status?: string;
  totalAmount?: string;
  amount?: string;
  to?: string;
  txHash?: string;
  explorer?: string;
  hireMode?: string;
  kind?: string;
  settlement?: string | null;
  policyName?: string | null;
  x402SettlementTxHash?: string | null;
  x402Explorer?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  transfers?: Array<{
    to: string;
    amount: string;
    txHash?: string;
    explorer?: string;
    label?: string;
  }>;
  error?: string;
  policyId?: string;
};

function usdcToBaseUnits(amount: string): string | null {
  const t = amount.trim();
  if (!t || !/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const frac = (f + "000000").slice(0, 6);
  const raw = `${w}${frac}`.replace(/^0+(?=\d)/, "");
  return raw || "0";
}

function formatUsdc(base?: string | null) {
  if (!base) return "0.00";
  const n = Number(base) / 1e6;
  if (!Number.isFinite(n)) return base;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function RemifiApp() {
  const [tab, setTab] = useState<Tab>("split");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [lastJob, setLastJob] = useState<JobResult | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobResult[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsErr, setJobsErr] = useState<string | null>(null);
  const [proofFilter, setProofFilter] = useState<ProofFilter>("all");
  const [savedPolicies, setSavedPolicies] = useState<SavedPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [splitMode, setSplitMode] = useState<"payroll" | "create">("payroll");
  const [policyInputMode, setPolicyInputMode] = useState<"english" | "manual">(
    "english",
  );
  const [manualRecipients, setManualRecipients] = useState([
    { address: "vitalik.eth", bps: "60", label: "ops" },
    {
      address: "0xB98cFAC37b8bD7f549789718aC17F8aEE7cE0c37",
      bps: "40",
      label: "growth",
    },
  ]);
  const [policySearch, setPolicySearch] = useState("");
  const wallet = useMiniPayWallet();

  const [policyName, setPolicyName] = useState("Team payroll");
  const [englishText, setEnglishText] = useState(
    "Split 60% to ops at vitalik.eth and 40% to growth at 0xB98cFAC37b8bD7f549789718aC17F8aEE7cE0c37",
  );
  const [splitAmount, setSplitAmount] = useState("1.00");
  const [policyId, setPolicyId] = useState("");
  const [resolvedPreview, setResolvedPreview] = useState<string | null>(null);

  const [payTo, setPayTo] = useState(
    "0x7f8008bd9bba0da001d13c1833ce7fa650e82b6b",
  );
  const [payAmount, setPayAmount] = useState("0.01");
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<string | null>(null);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [inMiniPay, setInMiniPay] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setInMiniPay(isMiniPayRuntime());
    setIsMobile(isMobileDevice());
  }, []);

  const loadWalletBalance = useCallback(async (): Promise<boolean> => {
    if (!wallet.address) {
      setWalletUsdcBalance(null);
      return false;
    }
    if (
      health?.agentAddress &&
      wallet.address.toLowerCase() === health.agentAddress.toLowerCase()
    ) {
      setWalletUsdcBalance(null);
      return false;
    }
    try {
      const res = await fetch(
        `/api/wallet/balance?address=${encodeURIComponent(wallet.address)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Balance lookup failed");
      }
      setWalletUsdcBalance(
        typeof data.balance === "string" ? data.balance : null,
      );
      return true;
    } catch {
      setWalletUsdcBalance(null);
      return false;
    }
  }, [wallet.address, health?.agentAddress]);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Health failed");
      setHealth(data);
      setHealthErr(null);
    } catch (e) {
      setHealthErr(e instanceof Error ? e.message : "Health failed");
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const loadRecentJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch("/api/jobs?limit=50", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load proof ledger");
      setRecentJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setJobsErr(null);
    } catch (e) {
      setJobsErr(e instanceof Error ? e.message : "Failed to load proof ledger");
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "status") void loadRecentJobs();
  }, [tab, loadRecentJobs]);

  const loadSavedPolicies = useCallback(
    async (opts?: { silent?: boolean }): Promise<SavedPolicy[]> => {
      if (!opts?.silent) setPoliciesLoading(true);
      try {
        const res = await fetch("/api/policies?limit=100", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load policies");
        const policies = sortPoliciesNewestFirst(
          (Array.isArray(data.policies) ? data.policies : [])
            .map(normalizePolicy)
            .filter((p: SavedPolicy | null): p is SavedPolicy => p !== null),
        );
        setSavedPolicies(policies);
        return policies;
      } catch (e) {
        if (!opts?.silent) {
          setToast({
            kind: "err",
            text: e instanceof Error ? e.message : "Failed to load policies",
          });
        }
        return [];
      } finally {
        if (!opts?.silent) setPoliciesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (tab === "split") void loadSavedPolicies();
  }, [tab, loadSavedPolicies]);

  useEffect(() => {
    if (wallet.address) void loadWalletBalance();
  }, [wallet.address, loadWalletBalance]);

  useEffect(() => {
    if (tab === "split" || tab === "pay") void loadWalletBalance();
  }, [tab, loadWalletBalance]);

  function formatBalanceLine(raw: string | null | undefined) {
    if (!raw) return "—";
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }

  function applyMaxAmount(setter: (value: string) => void) {
    const walletN = walletUsdcBalance ? Number(walletUsdcBalance) : 0;
    if (walletN <= 0) {
      setToast({
        kind: "err",
        text: wallet.address
          ? "No USDC in your wallet on Celo"
          : "Connect your wallet to use Max",
      });
      return;
    }
    const formatted = usdcDecimalForInput(walletN);
    if (formatted) setter(formatted);
  }

  async function ensureUsdcForPay(amountStr: string): Promise<boolean> {
    const amount = BigInt(amountStr);
    const hirePrice =
      health?.x402?.enabled && health.x402.hirePrice
        ? BigInt(health.x402.hirePrice)
        : 0n;
    const agentBal = health?.usdcBalance ? BigInt(health.usdcBalance) : 0n;
    const walletPaysHire = Boolean(wallet.address && !walletIsAgent && hirePrice > 0n);
    const agentNeed = walletPaysHire ? amount : amount + hirePrice;

    if (walletPaysHire) {
      const userBal = walletUsdcBalance ? BigInt(walletUsdcBalance) : 0n;
      const agentDeficit = agentBal >= amount ? 0n : amount - agentBal;
      const userNeed = hirePrice + agentDeficit;
      if (userBal < userNeed) {
        setToast({
          kind: "err",
          text: `Need ${formatUsdc(userNeed.toString())} USDC in your wallet (includes ${formatUsdc(hirePrice.toString())} x402 hire fee).`,
        });
        return false;
      }
    }

    if (agentBal >= agentNeed) return true;

    if (!wallet.address || walletIsAgent) {
      setToast({
        kind: "err",
        text: walletPaysHire
          ? "Not enough USDC on the agent. Connect your wallet with USDC on Celo, then try again."
          : "Not enough USDC. Connect your wallet with USDC on Celo, then try again.",
      });
      return false;
    }

    const agent = health?.agentAddress as Address | undefined;
    if (!agent) {
      setToast({ kind: "err", text: "Remifi is unavailable — refresh and try again" });
      return false;
    }

    const deficit = agentNeed - agentBal;
    try {
      setToast({ kind: "ok", text: "Using USDC from your wallet…" });
      await wallet.fundAgent(agent, deficit);
      await loadHealth();
      return true;
    } catch (e) {
      setToast({ kind: "err", text: friendlyWalletError(e) });
      return false;
    }
  }

  function x402HireConfig(resource: string) {
    if (!health?.x402?.enabled || !health.x402.payTo || !health.usdc) {
      return null;
    }
    return {
      resource,
      payTo: health.x402.payTo,
      hirePrice: health.x402.hirePrice,
      usdcAddress: health.usdc,
    };
  }

  async function postWithX402Hire(
    resource: string,
    body: Record<string, unknown>,
  ) {
    const connected = wallet.address ? await wallet.getWalletClient() : null;
    return fetchWithX402Hire(
      resource,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      connected,
      x402HireConfig(resource),
    );
  }

  function recipientsToText(
    recipients: Array<{ address: string; bps: number; label?: string }>,
  ) {
    const parts = recipients.map((r) => {
      const pct = r.bps % 100 === 0 ? String(r.bps / 100) : (r.bps / 100).toFixed(2);
      const who = r.label ? `${r.label} at ${r.address}` : r.address;
      return `${pct}% to ${who}`;
    });
    return `Split ${parts.join(" and ")}`;
  }

  function selectPolicy(policy: SavedPolicy) {
    setPolicyId(policy.policyId);
    setPolicyName(policy.name?.trim() || "Team payroll");
    setEnglishText(recipientsToText(policy.recipients));
    setResolvedPreview(summarizePolicyRecipients(policy.recipients));
  }

  function resetPolicyDraft() {
    setPolicyId("");
    setResolvedPreview(null);
    setPolicyName("Team payroll");
    setEnglishText(
      "Split 60% to ops at vitalik.eth and 40% to growth at 0xB98cFAC37b8bD7f549789718aC17F8aEE7cE0c37",
    );
    setManualRecipients([
      { address: "vitalik.eth", bps: "60", label: "ops" },
      {
        address: "0xB98cFAC37b8bD7f549789718aC17F8aEE7cE0c37",
        bps: "40",
        label: "growth",
      },
    ]);
    setPolicyInputMode("english");
  }

  function updateManualRecipient(
    index: number,
    field: "address" | "bps" | "label",
    value: string,
  ) {
    setManualRecipients((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
    if (policyId) setPolicyId("");
  }

  function addManualRecipient() {
    setManualRecipients((rows) => [...rows, { address: "", bps: "", label: "" }]);
    if (policyId) setPolicyId("");
  }

  function removeManualRecipient(index: number) {
    setManualRecipients((rows) =>
      rows.length <= 1 ? rows : rows.filter((_, i) => i !== index),
    );
    if (policyId) setPolicyId("");
  }

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const jsonHeaders: HeadersInit = { "content-type": "application/json" };

  async function savePolicy(): Promise<string | null> {
    setToast(null);
    setBusy(true);
    setResolvedPreview(null);
    try {
      let body: Record<string, unknown>;

      if (policyInputMode === "english") {
        if (!englishText.trim()) {
          throw new Error("Describe the split in plain English");
        }
        body = {
          text: englishText.trim(),
          name: policyName.trim() || undefined,
        };
      } else {
        const rows = manualRecipients.filter((r) => r.address.trim());
        if (rows.length === 0) {
          throw new Error("Add at least one recipient");
        }
        const recipients = rows.map((r) => {
          const pct = Number(r.bps);
          if (!Number.isFinite(pct) || pct <= 0) {
            throw new Error("Each share must be a positive percent");
          }
          return {
            address: r.address.trim(),
            bps: Math.round(pct * 100),
            ...(r.label.trim() ? { label: r.label.trim() } : {}),
          };
        });
        const totalBps = recipients.reduce((sum, r) => sum + r.bps, 0);
        if (totalBps !== 10_000) {
          throw new Error(`Shares must total 100% (currently ${totalBps / 100}%)`);
        }
        body = {
          name: policyName.trim() || undefined,
          recipients,
        };
      }

      const policyRes = await fetch("/api/policies", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      const policy = await policyRes.json();
      if (!policyRes.ok) throw new Error(policy.error || "Policy create failed");

      const id = String(policy.policyId);
      const savedRecipients = Array.isArray(policy.recipients)
        ? (policy.recipients as SavedPolicy["recipients"])
        : [];

      const saved =
        normalizePolicy({
          policyId: id,
          name: (policy.name ?? policyName.trim()) || null,
          recipients: savedRecipients,
          createdAt: policy.createdAt,
          updatedAt: policy.createdAt,
        }) ??
        ({
          policyId: id,
          name: policyName.trim() || null,
          recipients: savedRecipients,
          createdAt: policy.createdAt,
          updatedAt: policy.createdAt,
        } satisfies SavedPolicy);

      setSavedPolicies((prev) =>
        sortPoliciesNewestFirst([
          saved,
          ...prev.filter((p) => p.policyId !== id),
        ]),
      );
      setPolicySearch("");
      selectPolicy(saved);
      setSplitMode("payroll");
      setToast({
        kind: "ok",
        text: `${saved.name?.trim() || "Policy"} ready — enter amount and pay`,
      });
      const fresh = await loadSavedPolicies({ silent: true });
      const match = fresh.find((p) => p.policyId === id);
      if (match) selectPolicy(match);
      return id;
    } catch (e) {
      setToast({
        kind: "err",
        text: e instanceof Error ? e.message : "Policy create failed",
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function executePayroll(existingId?: string) {
    setToast(null);
    setBusy(true);
    try {
      const id = (existingId ?? policyId).trim();
      if (!id) {
        throw new Error("Add a split description, then pay — we’ll create the policy");
      }
      const amount = usdcToBaseUnits(splitAmount);
      if (!amount || amount === "0") throw new Error("Enter a valid USDC amount");
      if (!(await ensureUsdcForPay(amount))) return;

      const execRes = await postWithX402Hire("/api/execute", {
        policyId: id,
        amount,
        clientJobId: `ui-${Date.now()}`,
      });
      const job = await execRes.json();
      if (!execRes.ok) throw new Error(job.error || "Execute failed");

      setLastJob(job);
      setToast({
        kind: "ok",
        text: `Payroll sent · ${job.status ?? "completed"}`,
      });
      setTab("status");
      void loadHealth();
      void loadWalletBalance();
      void loadRecentJobs();
    } catch (e) {
      setToast({
        kind: "err",
        text: e instanceof Error ? e.message : "Execute failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function payPayroll() {
    const amount = usdcToBaseUnits(splitAmount);
    if (!amount || amount === "0") {
      setToast({ kind: "err", text: "Enter a valid USDC amount" });
      return;
    }
    const id = policyId.trim();
    if (!id) {
      setToast({ kind: "err", text: "Select a saved policy first" });
      return;
    }
    await executePayroll(id);
  }

  async function instantPay() {
    setToast(null);
    setBusy(true);
    try {
      const amount = usdcToBaseUnits(payAmount);
      if (!amount || amount === "0") throw new Error("Enter a valid USDC amount");
      if (!payTo.trim()) throw new Error("Enter a 0x, ENS, or Base name");
      if (!(await ensureUsdcForPay(amount))) return;

      const res = await postWithX402Hire("/api/pay", {
        to: payTo.trim(),
        amount,
      });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "Pay failed");

      setLastJob({
        ...job,
        totalAmount: job.amount,
        transfers: job.transfers ?? [
          {
            to: job.to,
            amount: job.amount,
            txHash: job.txHash,
            explorer: job.explorer,
          },
        ],
      });
      setToast({
        kind: "ok",
        text: `Sent · ${job.status ?? "completed"}`,
      });
      setTab("status");
      void loadHealth();
      void loadWalletBalance();
      void loadRecentJobs();
    } catch (e) {
      setToast({
        kind: "err",
        text: e instanceof Error ? e.message : "Pay failed",
      });
    } finally {
      setBusy(false);
    }
  }

  function formatJobWhen(iso?: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function jobHeading(job: JobResult) {
    if (job.kind === "instant") return "Send";
    return job.policyName?.trim() || "Payroll split";
  }

  function matchesProofFilter(job: JobResult) {
    switch (proofFilter) {
      case "sends":
        return job.kind === "instant";
      case "splits":
        return job.kind !== "instant";
      case "x402":
        return job.hireMode === "x402" || Boolean(job.x402SettlementTxHash);
      default:
        return true;
    }
  }

  const proofFilters: Array<{ id: ProofFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "sends", label: "Sends" },
    { id: "splits", label: "Splits" },
    { id: "x402", label: "x402" },
  ];

  const filteredJobs = recentJobs.filter(matchesProofFilter);

  const walletIsAgent = Boolean(
    wallet.address &&
      health?.agentAddress &&
      wallet.address.toLowerCase() === health.agentAddress.toLowerCase(),
  );

  const useMiniPayLink = isMobile && !inMiniPay;

  function friendlyWalletError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/42220|target chain|Current Chain ID: 1/i.test(msg)) {
      return useMiniPayLink
        ? "Open Remifi in MiniPay on Celo to pay with USDC"
        : "Switch your wallet to Celo mainnet to pay with USDC";
    }
    if (/personal wallet/i.test(msg)) return msg;
    return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
  }

  const userBalanceDisplay =
    wallet.address && !walletIsAgent
      ? formatBalanceLine(walletUsdcBalance)
      : "—";

  async function refreshHomeBalance() {
    if (!wallet.address || walletIsAgent) {
      setToast({
        kind: "err",
        text: inMiniPay ? "Connect MiniPay first" : "Connect your wallet first",
      });
      return;
    }
    setBalanceRefreshing(true);
    const ok = await loadWalletBalance();
    setBalanceRefreshing(false);
    if (!ok) {
      setToast({ kind: "err", text: "Could not refresh balance — try again" });
    }
  }

  const filteredPolicies = useMemo(() => {
    const sorted = sortPoliciesNewestFirst(savedPolicies);
    if (!policySearch.trim()) return sorted;
    return sorted.filter((p) => policyMatchesSearch(p, policySearch));
  }, [savedPolicies, policySearch]);

  const selectedPolicy = useMemo(
    () => savedPolicies.find((p) => p.policyId === policyId) ?? null,
    [savedPolicies, policyId],
  );

  useEffect(() => {
    if (tab !== "split" || splitMode !== "payroll" || policiesLoading) return;

    const visible = filteredPolicies;
    const selectedVisible = policyId
      ? visible.some((p) => p.policyId === policyId)
      : false;

    if (policyId && !savedPolicies.some((p) => p.policyId === policyId)) {
      if (visible[0]) selectPolicy(visible[0]);
      else setPolicyId("");
      return;
    }

    if (!policyId && visible[0]) {
      selectPolicy(visible[0]);
    } else if (policyId && !selectedVisible && visible[0]) {
      selectPolicy(visible[0]);
    }
  }, [
    tab,
    splitMode,
    policiesLoading,
    policyId,
    filteredPolicies,
    savedPolicies,
  ]);

  const tabs = [
    ["home", "Home"],
    ["split", "Split"],
    ["pay", "Pay"],
    ["status", "Proof"],
  ] as const;

  return (
    <div className="relative flex min-h-dvh w-full flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-28 pt-4 sm:max-w-xl sm:px-6 md:max-w-3xl lg:max-w-6xl lg:px-8 lg:pb-16 xl:max-w-7xl">
      <header className="pp-rise sticky top-0 z-20 -mx-4 mb-4 border-b border-pp-ink/5 bg-pp-soft/80 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:mb-8 lg:px-8 lg:py-4">
        <div className="flex items-center justify-between gap-3 lg:gap-6">
          <button
            type="button"
            onClick={() => setTab("home")}
            aria-label="Remifi home"
            className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg text-left transition hover:opacity-85 active:scale-[0.98]"
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pp-ink shadow-pp-soft lg:h-9 lg:w-9">
              <span className="absolute inset-[0.35rem] rounded-full border-2 border-pp-mint" />
              <span className="absolute -inset-1 animate-[pp-ring_2.4s_ease-out_infinite] rounded-full border border-pp-mint/55" />
            </span>
            <span className="text-lg font-extrabold tracking-[-0.045em] lg:text-xl">
              Remifi
            </span>
          </button>

          <nav className="hidden items-center gap-1 rounded-full border border-pp-ink/8 bg-white/70 p-1 lg:flex">
            {tabs.map(([id, label]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`min-h-9 rounded-full px-4 text-sm font-extrabold tracking-tight transition ${
                    active
                      ? "bg-pp-ink text-pp-white"
                      : "text-pp-muted hover:text-pp-ink"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {wallet.address ? (
              <span
                className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded-full border border-pp-mint-deep/45 bg-pp-mint/50 py-1.5 pl-2.5 pr-1.5 text-[0.7rem] font-extrabold tracking-tight text-pp-ink sm:max-w-[12rem]"
                title={wallet.address}
              >
                <span className="truncate">
                  {wallet.isMiniPay ? "MiniPay" : "Wallet"}{" "}
                  {shortAddr(wallet.address)}
                </span>
                {!inMiniPay && !wallet.isMiniPay ? (
                  <button
                    type="button"
                    onClick={() => void wallet.disconnect()}
                    aria-label="Disconnect wallet"
                    title="Disconnect wallet"
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sm leading-none text-pp-muted transition hover:bg-pp-ink/10 hover:text-pp-ink"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ) : null}
            {!inMiniPay ? (
              <button
                type="button"
                onClick={() => openInMiniPay()}
                className="inline-flex min-h-8 items-center rounded-full border border-pp-mint-deep/45 bg-pp-mint/70 px-2.5 text-[0.7rem] font-extrabold text-pp-ink transition active:scale-[0.98] sm:px-3"
              >
                Open MiniPay
              </button>
            ) : null}
            {!wallet.address ? (
              inMiniPay ? (
                wallet.connecting ? (
                  <span className="inline-flex min-h-8 items-center rounded-full border border-pp-ink/10 bg-pp-mist/80 px-3 text-[0.72rem] font-extrabold text-pp-muted">
                    Connecting MiniPay…
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={wallet.connecting}
                    onClick={() => void wallet.connect()}
                    className="inline-flex min-h-8 items-center rounded-full border border-pp-ink/10 bg-pp-ink px-3 text-[0.72rem] font-extrabold text-pp-white transition active:scale-[0.98] disabled:opacity-60"
                  >
                    Connect MiniPay
                  </button>
                )
              ) : !isMobile ? (
                <button
                  type="button"
                  disabled={wallet.connecting}
                  onClick={() => void wallet.connect()}
                  className="inline-flex min-h-8 items-center rounded-full border border-pp-ink/10 bg-pp-ink px-3 text-[0.72rem] font-extrabold text-pp-white transition active:scale-[0.98] disabled:opacity-60"
                >
                  {wallet.connecting ? "Connecting…" : "Connect wallet"}
                </button>
              ) : null
            ) : null}
            <span className="hidden min-h-8 items-center gap-1.5 rounded-full border border-pp-ink/10 bg-white/70 px-2.5 text-[0.72rem] font-extrabold uppercase tracking-[0.02em] sm:inline-flex">
              <i
                className={`relative block h-1.5 w-1.5 rounded-full ${
                  health?.chainOk ? "bg-pp-mint-deep" : "bg-pp-salmon"
                }`}
              >
                {health?.chainOk ? (
                  <span className="absolute -inset-[3px] animate-[pp-live-pulse_1.6s_ease-out_infinite] rounded-full border-[1.5px] border-pp-mint-deep opacity-65" />
                ) : null}
              </i>
              Celo
            </span>
          </div>
        </div>
      </header>

      {tab === "home" ? (
        <main className="flex flex-1 flex-col items-center gap-5 pb-16 lg:justify-center lg:gap-8 lg:pb-8">
          <div className="mx-auto flex w-full max-w-md flex-col gap-5 sm:max-w-lg lg:max-w-xl lg:gap-6 lg:mb-10">
            <section className="pp-rise text-center">
              <p className="mb-2 text-[0.74rem] font-extrabold uppercase tracking-[0.08em] text-pp-muted">
                Hireable payroll on Celo
              </p>
              <p className="mx-auto mt-3 max-w-xs text-[1.02rem] font-medium leading-snug text-pp-muted lg:max-w-md lg:text-lg">
                One execute. Every recipient paid.
              </p>
            </section>

            <section className="pp-rise rounded-[calc(var(--radius-pp)+0.15rem)] border border-pp-ink/5 bg-pp-white p-5 text-left shadow-pp lg:p-7">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[clamp(2rem,7vw,3rem)] font-extrabold tracking-[-0.04em] leading-none">
                    ${userBalanceDisplay}
                  </p>
                  <p className="mt-1.5 text-sm font-medium text-pp-muted lg:text-base">
                    {wallet.address && !walletIsAgent
                      ? "Your USDC balance"
                      : "Your USDC on Celo"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={balanceRefreshing}
                  onClick={() => void refreshHomeBalance()}
                  className="rounded-full border border-pp-ink/10 bg-pp-mist/80 px-3 py-1.5 text-xs font-bold text-pp-muted disabled:opacity-60"
                >
                  {balanceRefreshing ? "…" : "Refresh"}
                </button>
              </div>

              {wallet.address && !walletIsAgent ? null : inMiniPay && wallet.connecting ? (
                <p className="mt-4 text-xs font-medium text-pp-muted">
                  Connecting your MiniPay wallet…
                </p>
              ) : useMiniPayLink ? (
                <p className="mt-4 text-xs font-medium text-pp-muted">
                  <button
                    type="button"
                    onClick={() => openInMiniPay()}
                    className="font-bold text-pp-ink underline decoration-pp-mint-deep/50 underline-offset-2"
                  >
                    Open in MiniPay
                  </button>{" "}
                  to connect and pay with USDC.
                </p>
              ) : walletIsAgent ? (
                <p className="mt-4 text-xs font-semibold text-[#7a322e]">
                  That is the Remifi service wallet — connect your personal
                  wallet to pay.
                </p>
              ) : !inMiniPay ? (
                <p className="mt-4 text-xs font-medium text-pp-muted">
                  {isMobile ? null : (
                    <>Connect your wallet in the header, or </>
                  )}
                  <button
                    type="button"
                    onClick={() => openInMiniPay()}
                    className="font-bold text-pp-ink underline decoration-pp-mint-deep/50 underline-offset-2"
                  >
                    open in MiniPay
                  </button>
                  {isMobile ? " to connect and pay with USDC." : " on your phone."}
                </p>
              ) : (
                <p className="mt-4 text-xs font-medium text-pp-muted">
                  Connect MiniPay in the header to see your balance and pay.
                </p>
              )}
              {wallet.error ? (
                <p className="mt-1 text-xs font-semibold text-[#7a322e]">
                  {wallet.error}
                </p>
              ) : null}

              <div className="mt-5 grid grid-cols-[1fr_auto_1fr] gap-2 lg:mt-7 lg:gap-3">
                <button
                  type="button"
                  onClick={() => setTab("split")}
                  className="min-h-12 rounded-full bg-pp-ink px-4 text-sm font-bold text-pp-white shadow-pp-soft transition active:scale-[0.98] lg:min-h-14"
                >
                  + Split
                </button>
                <button
                  type="button"
                  onClick={() => setTab("status")}
                  className="min-h-12 rounded-full bg-pp-mist px-3 text-lg font-bold text-pp-ink lg:min-h-14"
                  aria-label="More"
                >
                  ···
                </button>
                <button
                  type="button"
                  onClick={() => setTab("pay")}
                  className="min-h-12 rounded-full bg-pp-ink px-4 text-sm font-bold text-pp-white shadow-pp-soft transition active:scale-[0.98] lg:min-h-14"
                >
                  Send →
                </button>
              </div>
            </section>
          </div>
        </main>
      ) : null}

      {tab === "split" ? (
        <main className="pp-rise mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 lg:max-w-2xl lg:gap-6">
          <div>
            <p className="text-[0.7rem] font-extrabold uppercase tracking-[0.08em] text-pp-muted">
              Payroll
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] lg:text-3xl">
              {splitMode === "create" ? "Create policy" : "Run payroll"}
            </h2>
            <p className="mt-1.5 text-sm font-medium text-pp-muted">
              {splitMode === "create"
                ? "Set recipients once — reuse every pay run."
                : "Pick a saved policy, enter amount, pay USDC on Celo."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 rounded-full border border-pp-ink/8 bg-white/80 p-1 shadow-pp-soft">
              <button
                type="button"
                onClick={() => setSplitMode("payroll")}
                className={`min-h-10 flex-1 rounded-full text-sm font-extrabold transition ${
                  splitMode === "payroll"
                    ? "bg-pp-ink text-pp-white shadow-pp-soft"
                    : "text-pp-muted hover:text-pp-ink"
                }`}
              >
                Run payroll
              </button>
              <button
                type="button"
                onClick={() => setSplitMode("create")}
                className={`min-h-10 flex-1 rounded-full text-sm font-extrabold transition ${
                  splitMode === "create"
                    ? "bg-pp-ink text-pp-white shadow-pp-soft"
                    : "text-pp-muted hover:text-pp-ink"
                }`}
              >
                Create policy
              </button>
            </div>
          </div>

          {splitMode === "create" ? (
            <div className="grid gap-5 rounded-[calc(var(--radius-pp)+0.15rem)] border border-pp-ink/5 bg-pp-white p-4 shadow-pp sm:p-6 lg:p-7">
              <div className="flex rounded-full bg-pp-mist/80 p-1">
                <button
                  type="button"
                  onClick={() => setPolicyInputMode("english")}
                  className={`min-h-9 flex-1 rounded-full text-xs font-extrabold transition sm:text-sm ${
                    policyInputMode === "english"
                      ? "bg-white text-pp-ink shadow-pp-soft"
                      : "text-pp-muted"
                  }`}
                >
                  Plain English
                </button>
                <button
                  type="button"
                  onClick={() => setPolicyInputMode("manual")}
                  className={`min-h-9 flex-1 rounded-full text-xs font-extrabold transition sm:text-sm ${
                    policyInputMode === "manual"
                      ? "bg-white text-pp-ink shadow-pp-soft"
                      : "text-pp-muted"
                  }`}
                >
                  Manual
                </button>
              </div>

              <label className="grid gap-1.5">
                <span className="text-sm font-bold">Policy name</span>
                <input
                  value={policyName}
                  onChange={(e) => setPolicyName(e.target.value)}
                  placeholder="Team payroll"
                  className="min-h-12 w-full rounded-[0.95rem] border border-[#e4e4e4] bg-[#f7f8f6] px-4 text-[0.92rem] font-medium outline-none transition focus:border-pp-teal focus:bg-white"
                />
              </label>

              {policyInputMode === "english" ? (
                <label className="grid gap-1.5">
                  <span className="text-sm font-bold">Who gets what</span>
                  <textarea
                    value={englishText}
                    onChange={(e) => {
                      setEnglishText(e.target.value);
                      if (policyId) setPolicyId("");
                    }}
                    rows={5}
                    placeholder="Split 60% to ops at alice.base.eth and 40% to growth at vitalik.eth"
                    className="min-h-32 w-full resize-y rounded-[0.95rem] border border-[#e4e4e4] bg-[#f7f8f6] px-4 py-3 text-[0.92rem] font-medium leading-snug outline-none transition focus:border-pp-teal focus:bg-white"
                  />
                  <p className="text-xs font-medium text-pp-muted">
                    Names, ENS, Base names, or 0x addresses — we resolve and validate shares.
                  </p>
                </label>
              ) : (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">Recipients</span>
                    <button
                      type="button"
                      onClick={addManualRecipient}
                      className="rounded-full border border-pp-ink/10 px-3 py-1 text-xs font-extrabold text-pp-ink hover:bg-pp-mist"
                    >
                      + Add
                    </button>
                  </div>
                  <ul className="grid gap-2">
                    {manualRecipients.map((row, index) => (
                      <li
                        key={`manual-${index}`}
                        className="grid gap-2 rounded-[var(--radius-pp-sm)] border border-pp-ink/6 bg-pp-mist/35 p-3 sm:grid-cols-[1fr_4.5rem_5.5rem_auto] sm:items-end sm:gap-2"
                      >
                        <label className="grid gap-1">
                          <span className="text-[0.68rem] font-bold uppercase tracking-wide text-pp-muted">
                            Address / name
                          </span>
                          <input
                            value={row.address}
                            onChange={(e) =>
                              updateManualRecipient(index, "address", e.target.value)
                            }
                            placeholder="0x… or vitalik.eth"
                            className="min-h-10 w-full rounded-xl border border-[#e4e4e4] bg-white px-3 font-mono text-xs outline-none focus:border-pp-teal"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[0.68rem] font-bold uppercase tracking-wide text-pp-muted">
                            Label
                          </span>
                          <input
                            value={row.label}
                            onChange={(e) =>
                              updateManualRecipient(index, "label", e.target.value)
                            }
                            placeholder="ops"
                            className="min-h-10 w-full rounded-xl border border-[#e4e4e4] bg-white px-3 text-sm outline-none focus:border-pp-teal"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[0.68rem] font-bold uppercase tracking-wide text-pp-muted">
                            %
                          </span>
                          <input
                            inputMode="decimal"
                            value={row.bps}
                            onChange={(e) =>
                              updateManualRecipient(index, "bps", e.target.value)
                            }
                            placeholder="60"
                            className="min-h-10 w-full rounded-xl border border-[#e4e4e4] bg-white px-3 text-sm outline-none focus:border-pp-teal"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeManualRecipient(index)}
                          disabled={manualRecipients.length <= 1}
                          className="min-h-10 rounded-xl px-2 text-xs font-extrabold text-pp-muted enabled:hover:bg-white enabled:hover:text-pp-ink disabled:opacity-40"
                          aria-label="Remove recipient"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs font-medium text-pp-muted">
                    Percentages must total exactly 100%.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-pp-ink/6 pt-4">
                <button
                  type="button"
                  onClick={resetPolicyDraft}
                  className="min-h-11 rounded-full border border-pp-ink/10 px-5 text-sm font-extrabold text-pp-muted hover:text-pp-ink"
                >
                  Reset
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void savePolicy()}
                  className="min-h-11 flex-1 rounded-full bg-pp-ink px-6 text-sm font-extrabold text-pp-white shadow-pp transition enabled:active:scale-[0.985] disabled:opacity-60 sm:flex-none"
                >
                  {busy ? "Saving…" : "Save policy"}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 rounded-[calc(var(--radius-pp)+0.15rem)] border border-pp-ink/5 bg-pp-white p-4 shadow-pp sm:p-6 lg:p-7">
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="grid flex-1 gap-1.5">
                    <span className="text-sm font-bold">Search policies</span>
                    <input
                      type="search"
                      value={policySearch}
                      onChange={(e) => setPolicySearch(e.target.value)}
                      placeholder="e.g. ops-growth-split"
                      className="min-h-11 w-full rounded-[0.95rem] border border-[#e4e4e4] bg-[#f7f8f6] px-4 text-[0.92rem] font-medium outline-none transition focus:border-pp-teal focus:bg-white"
                    />
                  </label>
                  {policiesLoading && savedPolicies.length > 0 ? (
                    <span className="shrink-0 pt-7 text-xs font-semibold text-pp-muted">
                      Updating…
                    </span>
                  ) : null}
                </div>

                {policiesLoading && savedPolicies.length === 0 ? (
                  <p className="py-6 text-center text-sm font-medium text-pp-muted">
                    Loading policies…
                  </p>
                ) : savedPolicies.length === 0 ? (
                  <div className="rounded-[var(--radius-pp-sm)] border border-dashed border-pp-ink/12 bg-pp-mist/30 px-4 py-8 text-center">
                    <p className="text-sm font-semibold text-pp-ink">No policies yet</p>
                    <p className="mt-1 text-xs font-medium text-pp-muted">
                      Create one above, then run payroll as many times as you need.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSplitMode("create")}
                      className="mt-4 min-h-10 rounded-full bg-pp-ink px-5 text-sm font-extrabold text-pp-white"
                    >
                      Create policy
                    </button>
                  </div>
                ) : filteredPolicies.length === 0 ? (
                  <p className="rounded-[var(--radius-pp-sm)] border border-pp-ink/6 bg-pp-mist/30 px-4 py-6 text-center text-sm font-medium text-pp-muted">
                    No policies match &ldquo;{policySearch.trim()}&rdquo;
                  </p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-pp-muted">
                      {filteredPolicies.length} of {savedPolicies.length} polic
                      {savedPolicies.length === 1 ? "y" : "ies"}
                      {policySearch.trim() ? " matching search" : ""}
                    </p>
                    <ul className="grid max-h-64 gap-2 overflow-y-auto pr-0.5">
                    {filteredPolicies.map((policy) => {
                      const selected = policyId === policy.policyId;
                      return (
                        <li key={policy.policyId}>
                          <button
                            type="button"
                            onClick={() => selectPolicy(policy)}
                            className={`flex w-full flex-col gap-1 rounded-[var(--radius-pp-sm)] border px-4 py-3.5 text-left transition ${
                              selected
                                ? "border-pp-teal/50 bg-pp-mint/30 shadow-pp-soft"
                                : "border-pp-ink/6 bg-pp-mist/25 hover:border-pp-ink/12 hover:bg-pp-mist/50"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-extrabold text-pp-ink">
                                {policy.name?.trim() || "Untitled policy"}
                              </span>
                              {selected ? (
                                <span className="shrink-0 rounded-full bg-pp-ink px-2 py-0.5 text-[0.65rem] font-extrabold text-pp-white">
                                  Selected
                                </span>
                              ) : null}
                            </div>
                            <span className="text-xs font-medium leading-snug text-pp-muted">
                              {summarizePolicyRecipients(policy.recipients)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    </ul>
                  </>
                )}
              </div>

              {selectedPolicy ? (
                <div className="rounded-[var(--radius-pp-sm)] border border-pp-teal/35 bg-pp-mint/25 px-4 py-3.5">
                  <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.06em] text-pp-muted">
                    Ready to pay
                  </p>
                  <p className="mt-1 text-base font-extrabold tracking-tight text-pp-ink">
                    {selectedPolicy.name?.trim() || "Untitled policy"}
                  </p>
                  <p className="mt-1 text-sm font-medium leading-snug text-pp-muted">
                    {summarizePolicyRecipients(selectedPolicy.recipients)}
                  </p>
                </div>
              ) : null}

              <label className="grid gap-1.5">
                <span className="text-sm font-bold">
                  Amount <span className="text-pp-salmon">*</span>
                </span>
                <div className="relative">
                  <input
                    inputMode="decimal"
                    value={splitAmount}
                    onChange={(e) => setSplitAmount(e.target.value)}
                    placeholder="1.00"
                    className="min-h-12 w-full rounded-[0.95rem] border border-[#e4e4e4] bg-[#f7f8f6] px-4 pr-24 text-[0.92rem] font-medium outline-none transition focus:border-pp-teal focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => applyMaxAmount(setSplitAmount)}
                    className="absolute right-14 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-[0.7rem] font-extrabold text-pp-ink transition hover:bg-pp-mist"
                  >
                    Max
                  </button>
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-extrabold text-pp-muted">
                    USDC
                  </span>
                </div>
                <p className="text-xs font-medium text-pp-muted">
                  Your balance{" "}
                  <strong className="text-pp-ink">
                    ${formatBalanceLine(walletUsdcBalance)} USDC
                  </strong>
                </p>
              </label>

              <button
                type="button"
                disabled={busy || !policyId}
                onClick={() => void payPayroll()}
                className="flex min-h-12 w-full items-center justify-center rounded-full bg-pp-ink px-6 text-sm font-extrabold text-pp-white shadow-pp transition enabled:active:scale-[0.985] disabled:opacity-50"
              >
                {busy ? "Paying…" : "Pay USDC"}
              </button>
            </div>
          )}
        </main>
      ) : null}

      {tab === "pay" ? (
        <main className="pp-rise mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 lg:max-w-2xl lg:gap-6">
          <div>
            <p className="text-[0.7rem] font-extrabold uppercase tracking-[0.08em] text-pp-muted">
              Instant
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] lg:text-3xl">
              Send
            </h2>
          </div>
          <div className="grid gap-4 rounded-[calc(var(--radius-pp)+0.15rem)] border border-pp-ink/5 bg-pp-white p-4 shadow-pp sm:p-5 lg:grid-cols-2 lg:gap-6 lg:p-7">
            <label className="grid gap-1.5 lg:col-span-2">
              <span className="text-sm font-bold">
                To <span className="text-pp-salmon">*</span>
              </span>
              <input
                value={payTo}
                onChange={(e) => setPayTo(e.target.value)}
                placeholder="0x… or name.eth / name.base.eth"
                className="min-h-[3.35rem] w-full rounded-[0.95rem] border border-[#e4e4e4] bg-[#f7f8f6] px-4 font-mono text-sm font-medium outline-none focus:border-pp-teal focus:bg-white"
              />
            </label>
            <label className="grid gap-1.5 lg:col-span-2">
              <span className="text-sm font-bold">Amount (USDC)</span>
              <div className="relative">
                <input
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="min-h-[3.35rem] w-full rounded-[0.95rem] border border-[#e4e4e4] bg-[#f7f8f6] px-4 pr-24 text-[0.92rem] font-medium outline-none focus:border-pp-teal focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => applyMaxAmount(setPayAmount)}
                  className="absolute right-14 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-[0.7rem] font-extrabold text-pp-ink transition hover:bg-pp-mist"
                >
                  Max
                </button>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-extrabold text-pp-muted">
                  USDC
                </span>
              </div>
              <p className="text-xs font-medium text-pp-muted">
                Your balance{" "}
                <strong className="text-pp-ink">
                  ${formatBalanceLine(walletUsdcBalance)} USDC
                </strong>
              </p>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void instantPay()}
              className="flex min-h-[3.75rem] w-full items-center justify-center rounded-full bg-pp-ink px-6 text-base font-bold text-pp-white shadow-pp disabled:opacity-60 lg:col-span-2"
            >
              {busy ? "Sending…" : "Send USDC"}
            </button>
          </div>
        </main>
      ) : null}

      {tab === "status" ? (
        <main className="pp-rise mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 lg:max-w-4xl lg:gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[0.7rem] font-extrabold uppercase tracking-[0.08em] text-pp-muted">
                Proof
              </p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] lg:text-3xl">
                Settlement ledger
              </h2>
              <p className="mt-1.5 text-sm font-medium text-pp-muted">
                All agent payroll, x402 hires, and tagged sends — on-chain proof for everyone.
              </p>
            </div>
            <button
              type="button"
              disabled={jobsLoading}
              onClick={() => void loadRecentJobs()}
              className="min-h-10 rounded-full border border-pp-ink/10 bg-pp-mist/90 px-4 text-sm font-extrabold text-pp-ink disabled:opacity-60"
            >
              {jobsLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <section className="rounded-[var(--radius-pp)] border border-pp-ink/5 bg-pp-white p-4 shadow-pp lg:p-7">
            <div className="flex flex-wrap gap-2">
              {proofFilters.map(({ id, label }) => {
                const active = proofFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setProofFilter(id)}
                    className={`rounded-full px-3 py-1.5 text-[0.74rem] font-bold transition ${
                      active
                        ? "bg-pp-ink text-pp-white"
                        : "bg-pp-mist text-pp-muted hover:text-pp-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {jobsErr ? (
              <p className="mt-4 rounded-[var(--radius-pp-sm)] bg-pp-salmon/28 px-3 py-2 text-sm text-[#7a322e]">
                {jobsErr}
              </p>
            ) : null}

            {!jobsLoading && recentJobs.length === 0 ? (
              <p className="mt-4 text-sm font-medium text-pp-muted lg:text-base">
                No settlements yet. Run a split or send to see transfers and Celoscan links here.
              </p>
            ) : !jobsLoading && filteredJobs.length === 0 ? (
              <p className="mt-4 text-sm font-medium text-pp-muted lg:text-base">
                No {proofFilter === "all" ? "settlements" : proofFilter} in the ledger yet.
              </p>
            ) : (
              <ul className="mt-4 grid gap-4 lg:mt-6">
                {filteredJobs.map((job, idx) => {
                    const isLatest =
                      idx === 0 &&
                      (lastJob?.jobId ? lastJob.jobId === job.jobId : true);
                    const isInstant = job.kind === "instant";

                    if (isInstant && (job.transfers ?? []).length === 1) {
                      const t = job.transfers![0];
                      return (
                        <li
                          key={job.jobId ?? `job-${idx}`}
                          className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[var(--radius-pp-sm)] border px-3 py-3 ${
                            isLatest
                              ? "border-pp-mint-deep/35 bg-pp-mint/20"
                              : "border-pp-ink/6 bg-pp-mist/35"
                          }`}
                        >
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-pp-mint/90 text-[0.65rem] font-extrabold uppercase">
                            out
                          </span>
                          <div className="min-w-0">
                            <strong className="block truncate text-sm tracking-tight">
                              {shortAddr(t.to)}
                            </strong>
                            <span className="mt-0.5 block text-xs font-medium text-pp-muted">
                              {formatUsdc(t.amount)} USDC
                              {" · "}
                              {formatJobWhen(job.completedAt ?? job.createdAt)}
                            </span>
                          </div>
                          {t.explorer || t.txHash ? (
                            <a
                              href={
                                t.explorer ??
                                `https://celoscan.io/tx/${t.txHash}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-extrabold text-pp-ink underline underline-offset-2"
                            >
                              Tx ↗
                            </a>
                          ) : (
                            <span className="text-xs font-bold text-pp-muted">—</span>
                          )}
                        </li>
                      );
                    }

                    return (
                      <li
                        key={job.jobId ?? `job-${idx}`}
                        className={`grid gap-3 rounded-[var(--radius-pp-sm)] border p-4 ${
                          isLatest
                            ? "border-pp-mint-deep/35 bg-pp-mint/20"
                            : "border-pp-ink/6 bg-pp-mist/35"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            {!isInstant ? (
                              <p className="text-xs font-extrabold uppercase tracking-[0.06em] text-pp-muted">
                                Payroll split
                                {job.settlement ? ` · ${job.settlement}` : ""}
                              </p>
                            ) : null}
                            <h3 className="mt-1 text-base font-extrabold tracking-[-0.03em] break-all lg:text-lg">
                              {jobHeading(job)}
                            </h3>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-pp-muted">
                            {formatJobWhen(job.completedAt ?? job.createdAt)}
                          </span>
                        </div>

                        <p className="text-sm font-medium text-pp-muted">
                          Status{" "}
                          <strong className="text-pp-ink">{job.status ?? "—"}</strong>
                          {job.hireMode ? ` · hire ${job.hireMode}` : ""}
                          {job.totalAmount
                            ? ` · ${formatUsdc(job.totalAmount)} USDC`
                            : ""}
                        </p>

                        {job.x402SettlementTxHash ? (
                          <p className="text-sm font-medium text-pp-muted">
                            x402 settle{" "}
                            <a
                              className="font-mono text-pp-ink underline"
                              href={
                                job.x402Explorer ??
                                `https://celoscan.io/tx/${job.x402SettlementTxHash}`
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              {shortAddr(job.x402SettlementTxHash)}
                            </a>
                          </p>
                        ) : null}

                        {(job.transfers ?? []).length ? (
                          <ul className="grid gap-2 md:grid-cols-2">
                            {(job.transfers ?? []).map((t, i) => (
                              <li
                                key={`${job.jobId}-${t.to}-${i}`}
                                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-pp-white/80 px-3 py-3"
                              >
                                <span className="grid h-10 w-10 place-items-center rounded-xl bg-pp-mint/90 text-[0.65rem] font-extrabold uppercase">
                                  out
                                </span>
                                <div className="min-w-0">
                                  <strong className="block truncate text-sm tracking-tight">
                                    {t.label ? `${t.label} · ` : ""}
                                    {shortAddr(t.to)}
                                  </strong>
                                  <span className="mt-0.5 block text-xs font-medium text-pp-muted">
                                    {formatUsdc(t.amount)} USDC
                                  </span>
                                </div>
                                {t.explorer || t.txHash ? (
                                  <a
                                    href={
                                      t.explorer ??
                                      `https://celoscan.io/tx/${t.txHash}`
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-extrabold text-pp-ink underline underline-offset-2"
                                  >
                                    Tx ↗
                                  </a>
                                ) : (
                                  <span className="text-xs font-bold text-pp-muted">
                                    —
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  },
                )}
              </ul>
            )}

            {jobsLoading && recentJobs.length === 0 ? (
              <p className="mt-4 text-sm font-medium text-pp-muted">Loading settlements…</p>
            ) : null}
          </section>
        </main>
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`pp-toast fixed left-1/2 z-40 w-[min(100%-1.5rem,28rem)] -translate-x-1/2 rounded-full px-5 py-3.5 text-center text-sm font-extrabold tracking-tight shadow-pp backdrop-blur-md bottom-[5.75rem] lg:bottom-8 ${
            toast.kind === "ok"
              ? "border border-pp-mint-deep/50 bg-pp-mint/90 text-pp-ink"
              : "border border-pp-salmon/60 bg-[#fff1ef]/95 text-[#7a322e]"
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      <nav className="fixed bottom-4 left-1/2 z-30 w-[min(100%-1.5rem,28rem)] -translate-x-1/2 rounded-full border border-pp-ink/5 bg-pp-white/95 p-1.5 shadow-pp backdrop-blur-md lg:hidden">
        <ul className="grid grid-cols-4 gap-1">
          {tabs.map(([id, label]) => {
            const active = tab === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex min-h-11 w-full items-center justify-center rounded-full text-xs font-extrabold tracking-tight transition ${
                    active
                      ? "bg-pp-ink text-pp-white"
                      : "text-pp-muted hover:text-pp-ink"
                  }`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      </div>

      <footer className="pp-rise-slow mt-auto hidden w-full border-t border-pp-ink/10 bg-pp-white/90 backdrop-blur-md lg:block">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-6 px-8 py-6 xl:max-w-7xl">
          <div className="grid gap-2">
            <div className="inline-flex items-center gap-2.5">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pp-ink">
                <span className="absolute inset-[0.3rem] rounded-full border-2 border-pp-mint" />
              </span>
              <strong className="text-base font-extrabold tracking-[-0.035em]">
                Remifi
              </strong>
            </div>
            <p className="max-w-xs pl-9 text-sm font-medium leading-snug text-pp-muted">
              Hireable USDC payroll & revenue splits on Celo.
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="border-b-[1.5px] border-transparent pb-0.5 text-sm font-bold tracking-tight text-pp-ink transition hover:border-pp-mint-deep"
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-pp-ink/10 px-8 py-3.5 text-xs font-medium text-pp-muted xl:max-w-7xl">
          <span>Celo mainnet · Circle USDC · Operated by Remifi</span>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 font-bold text-pp-ink">
            <a href="/legal/terms" className="underline underline-offset-2">
              Terms
            </a>
            <a href="/legal/privacy" className="underline underline-offset-2">
              Privacy
            </a>
            <a
              href="https://t.me/allenrel"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Support
            </a>
          </nav>
        </div>
      </footer>

      {/* Mobile legal strip (MiniPay listing requires in-app Terms + Privacy + Support) */}
      <div className="mx-auto w-full max-w-md px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-2 text-center text-[0.68rem] font-semibold text-pp-muted lg:hidden">
        <a href="/legal/terms" className="underline underline-offset-2">
          Terms
        </a>
        {" · "}
        <a href="/legal/privacy" className="underline underline-offset-2">
          Privacy
        </a>
        {" · "}
        <a
          href="https://t.me/allenrel"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Support
        </a>
        <span className="mt-1 block font-medium">Operated by Remifi — not MiniPay</span>
      </div>
    </div>
  );
}
