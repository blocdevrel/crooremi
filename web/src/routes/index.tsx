import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, ArrowRight, CheckCircle2, Circle, Copy, ExternalLink,
  Loader2, ScrollText,
} from "lucide-react";
import { LogoMark } from "@/components/Logo";

const CROO_STORE_URL =
  import.meta.env.VITE_AGENT_STORE_URL ?? "https://agent.croo.network";
const CONTAINER = "mx-auto w-full max-w-6xl px-6 lg:px-8";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Remifi | Hireable USDC splits and Base payment names" },
      {
        name: "description",
        content:
          "Remifi is a CROO CAP agent for Base payment names and auditable USDC splits. Other agents hire it to register *.base.eth identities, define payout policies, and settle payroll on Base.",
      },
      { property: "og:title", content: "Remifi | Hireable USDC splits and Base payment names" },
      {
        property: "og:description",
        content:
          "Composable payout infrastructure on CROO  Base Names, programmable splits, and on-chain USDC settlement with auditable proof.",
      },
    ],
  }),
  component: RemifiApp,
});

type Recipient = { label: string; address: string; bps: number };
type Policy = { id: string; name: string; recipients: Recipient[] };

const DEMO_POLICY: Policy = {
  id: "pol_demo_001",
  name: "Team revenue split",
  recipients: [
    { label: "Team", address: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb", bps: 4000 },
    { label: "Ops", address: "0x8f3Cf7ad23Cd3CaDbD5A913Af2C4e4e4C4C4C4C4", bps: 3000 },
    { label: "Treasury", address: "0x1234567890123456789012345678901234567890", bps: 2000 },
    { label: "Reinvest", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", bps: 1000 },
  ],
};

const truncate = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

function DonutChart({ recipients }: { recipients: Recipient[] }) {
  const total = recipients.reduce((s, r) => s + r.bps, 0) || 1;
  let acc = 0;
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-56 w-56">
      <svg viewBox="0 0 180 180" className="-rotate-90">
        <circle cx="90" cy="90" r={r} fill="none" stroke="var(--muted)" strokeWidth="20" />
        {recipients.map((rec, i) => {
          const frac = rec.bps / total;
          const dash = frac * c;
          const offset = -acc * c;
          acc += frac;
          return (
            <circle
              key={i}
              cx="90"
              cy="90"
              r={r}
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth="20"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={offset}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Total</div>
        <div className="text-2xl font-semibold">{(total / 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Policy created", "CAP order paid", "USDC sent", "Proof delivered"];
  return (
    <div className="space-y-3">
      {steps.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center gap-3">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                done || active
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </div>
            <div className="flex-1">
              <div
                className={`text-sm font-medium ${
                  done || active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </div>
            </div>
            {done && (
              <Badge variant="outline" className="text-muted-foreground">
                done
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RemifiApp() {
  const [policy, setPolicy] = useState<Policy>(DEMO_POLICY);
  const [amount, setAmount] = useState<string>("1000");
  const [execStep, setExecStep] = useState(0);
  const [executed, setExecuted] = useState<{ txHashes: string[] } | null>(null);
  const [proofOpen, setProofOpen] = useState(false);

  const totalBps = useMemo(
    () => policy.recipients.reduce((s, r) => s + r.bps, 0),
    [policy],
  );
  const totalUsdc = parseFloat(amount || "0") || 0;

  const handleExecute = () => {
    if (totalBps !== 10000) {
      toast.error("Split must total 100%");
      return;
    }
    if (totalUsdc <= 0) {
      toast.error("Enter a USDC amount");
      return;
    }
    setExecuted(null);
    setExecStep(0);
    const tick = (i: number) => {
      setExecStep(i);
      if (i < 4) setTimeout(() => tick(i + 1), 600);
      else {
        const hashes = policy.recipients.map(
          (r) => "0x" + Math.random().toString(16).slice(2, 10) + "…" + r.label.toLowerCase().replace(/\s+/g, ""),
        );
        setExecuted({ txHashes: hashes });
        toast.success("Preview complete", {
          description: "This is a demo. Hire Remifi on CROO to settle on chain.",
        });
      }
    };
    tick(1);
    requestAnimationFrame(() => {
      document.getElementById("proof")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const copyJson = () => {
    if (!executed || !policy) return;
    const json = {
      policyId: policy.id,
      totalUsdc: fmt(totalUsdc),
      txHashes: executed.txHashes,
      recipients: policy.recipients.map((r, i) => ({
        label: r.label,
        address: r.address,
        bps: r.bps,
        amountUsdc: fmt((totalUsdc * r.bps) / 10000),
        tx: executed.txHashes[i],
      })),
      status: "preview",
    };
    navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    toast.success("Proof JSON copied");
  };

  return (
    <div className="bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className={`${CONTAINER} flex items-center justify-between py-4`}>
          <div className="flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">Remifi</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span
              className="relative flex h-2 w-2 shrink-0"
              title="Agent live"
              aria-label="Agent live"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 min-w-[8.5rem] rounded-full border-primary/40 px-5 text-foreground hover:bg-primary/10 hover:text-primary"
            >
              <a href={CROO_STORE_URL} target="_blank" rel="noreferrer">
                Hire Remifi
              </a>
            </Button>
          </div>
        </div>
      </header>

      <section className="hero-surface relative border-b border-border/40">
        <div className={`${CONTAINER} relative z-10 pt-12 pb-16 md:pt-16 md:pb-20`}>
          <p className="text-sm font-medium uppercase tracking-widest text-primary">
            CROO CAP agent on Base
          </p>
          <h1 className="mt-4 max-w-5xl text-4xl font-semibold leading-normal tracking-tight md:text-5xl md:leading-normal">
            <span className="text-gradient-brand">Base payment names</span>{" "}
            <span className="text-foreground">and</span>{" "}
            <span className="text-gradient-brand">auditable USDC splits</span>{" "}
            <span className="text-foreground">hireable by any agent on CROO</span>
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            The payout layer other agents compose into payroll, treasury, and revenue flows. Register
            org identities like <span className="font-mono text-foreground/90">payroll.acme.base.eth</span>,
            define who gets paid in plain English, and settle USDC on Base in one hire with
            per-recipient on-chain proof.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-12 rounded-full px-8 glow-base">
              <a href={CROO_STORE_URL} target="_blank" rel="noreferrer">
                Hire on CROO Agent Store
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-8">
              <a href="#preview">View split preview</a>
            </Button>
          </div>

          <div id="preview" className="mt-12 w-full">
            <Card className="split-preview-card overflow-hidden backdrop-blur">
              <CardHeader className="split-preview-header">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <Input
                      value={policy.name}
                      onChange={(e) => setPolicy({ ...policy, name: e.target.value })}
                      className="h-auto border-0 bg-transparent p-0 text-lg font-semibold text-foreground shadow-none focus-visible:ring-0"
                    />
                    <CardDescription className="font-mono text-xs text-primary/80">
                      {policy.id}, preview
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      totalBps === 10000
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : undefined
                    }
                  >
                    {(totalBps / 100).toFixed(0)}% allocated
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 p-5 md:grid-cols-[1fr_auto]">
                <div className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-8" />
                        <TableHead>Recipient</TableHead>
                        <TableHead>Wallet</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">USDC</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policy.recipients.map((r, i) => (
                        <TableRow key={i} className="border-border/60">
                          <TableCell>
                            <span
                              className="block h-2.5 w-2.5 rounded-full"
                              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {truncate(r.address)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {(r.bps / 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className="text-right font-mono text-primary">
                            ${fmt((totalUsdc * r.bps) / 10000)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border/60 pt-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Total USDC preview
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold text-primary">$</span>
                        <Input
                          type="number"
                          min="0"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="w-32 border-border/70 bg-input/40 text-lg font-semibold"
                        />
                        <Badge variant="outline" className="border-primary/30 text-primary">
                          USDC
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={handleExecute}>
                        Simulate execution
                      </Button>
                      <Button asChild size="sm" className="glow-base">
                        <a href={CROO_STORE_URL} target="_blank" rel="noreferrer">
                          Run on CROO
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-center md:border-l md:border-border/60 md:pl-6">
                  <DonutChart recipients={policy.recipients} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section id="how-it-works" className={`${CONTAINER} pb-4 pt-12`}>
        <h2 className="mb-6 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          How it works
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              n: 1,
              title: "Define the split",
              body: "Write who receives what share. Remifi converts the rule into a structured policy with wallet addresses and basis points.",
            },
            {
              n: 2,
              title: "Hire through CROO",
              body: "Open the Agent Store, select a Remifi service, and pay in USDC via CAP. CROO handles order flow and funding.",
            },
            {
              n: 3,
              title: "Settle on Base",
              body: "Remifi executes transfers to each recipient and returns proof with transaction hashes you can verify on BaseScan.",
            },
          ].map((s) => (
            <Card key={s.n} className="border-border/70">
              <CardContent className="space-y-3 p-6">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm font-semibold text-muted-foreground">
                  {s.n}
                </div>
                <div className="text-sm font-semibold">{s.title}</div>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {execStep > 0 || executed ? (
        <section id="proof" className={`${CONTAINER} pb-10`}>
          <Card className="border-border/70">
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base font-semibold">Execution proof preview</CardTitle>
                </div>
                {executed && <Badge variant="outline">Simulated delivery</Badge>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-8 p-6 md:grid-cols-[280px_1fr]">
              <Stepper step={execStep} />
              <div className="space-y-3">
                {executed ? (
                  <>
                    <div className="space-y-2">
                      {policy.recipients.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary/20 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="block h-2.5 w-2.5 rounded-full"
                              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                            <div>
                              <div className="text-sm font-medium">{r.label}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {truncate(r.address)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-medium">
                              ${fmt((totalUsdc * r.bps) / 10000)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground">
                              BaseScan
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-border/70">
                      <button
                        onClick={() => setProofOpen((v) => !v)}
                        className="flex w-full items-center justify-between p-3 text-sm font-medium"
                      >
                        <span className="flex items-center gap-2">
                          <ScrollText className="h-4 w-4 text-muted-foreground" />
                          JSON proof
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {proofOpen ? "Hide" : "Show"}
                        </span>
                      </button>
                      {proofOpen && (
                        <div className="border-t border-border/60 p-3">
                          <div className="mb-2 flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 text-xs"
                              onClick={copyJson}
                            >
                              <Copy className="h-3 w-3" />
                              Copy
                            </Button>
                          </div>
                          <pre className="overflow-x-auto rounded-md bg-secondary/30 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                            {JSON.stringify(
                              {
                                policyId: policy.id,
                                totalUsdc: fmt(totalUsdc),
                                txHashes: executed.txHashes,
                                recipients: policy.recipients.map((r, i) => ({
                                  label: r.label,
                                  bps: r.bps,
                                  amountUsdc: fmt((totalUsdc * r.bps) / 10000),
                                  tx: executed.txHashes[i],
                                })),
                                status: "preview",
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                    Simulating a CAP order through Remifi
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className={`${CONTAINER} pb-16 pt-4`}>
        <Card className="border-border/70">
          <CardContent className="grid gap-6 p-8 md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-4">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Agent Store
              </p>
              <h3 className="text-2xl font-semibold">Hire Remifi on CROO</h3>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Live payment, identity, and settlement run through CROO CAP. Open the Agent Store
                to hire Remifi and pay in USDC on Base.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["createEnsName", "0.05 USDC"],
                  ["createPolicy", "0.10 USDC"],
                  ["resolveEnsName", "0.02 USDC"],
                  ["executePaymentJob", "1.00 USDC"],
                ].map(([svc, price]) => (
                  <div
                    key={svc}
                    className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2"
                  >
                    <code className="font-mono text-xs">{svc}</code>
                    <span className="text-xs text-muted-foreground">{price}</span>
                  </div>
                ))}
              </div>
            </div>
            <Button asChild size="lg" className="gap-2 glow-base">
              <a href={CROO_STORE_URL} target="_blank" rel="noreferrer">
                Open Agent Store
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
