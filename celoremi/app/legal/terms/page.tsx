import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Remifi",
  description: "Terms of Service for Remifi on Celo / MiniPay.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold text-pp-muted">
        <Link href="/" className="underline underline-offset-2">
          ← Remifi
        </Link>
      </p>
      <h1 className="mt-4 text-3xl font-extrabold tracking-[-0.04em]">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm font-medium text-pp-muted">
        Last updated: July 27, 2026 · Operated by Remifi (not MiniPay / Opera).
      </p>

      <div className="prose-pp mt-8 grid gap-5 text-[0.95rem] font-medium leading-relaxed text-pp-ink">
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">1. Service</h2>
          <p className="text-pp-muted">
            Remifi is a hireable USDC payroll and revenue-split agent on Celo
            mainnet. You may create split policies, execute multi-recipient
            payouts, and send tagged USDC transfers through our web Mini App
            and APIs.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">2. On-chain risk</h2>
          <p className="text-pp-muted">
            Blockchain transactions are irreversible. You are responsible for
            recipient addresses, amounts, and approving wallet prompts (including
            MiniPay). Network fees may apply. Remifi does not custody your
            MiniPay private keys.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">3. Eligibility</h2>
          <p className="text-pp-muted">
            You must comply with applicable laws and sanctions. Do not use Remifi
            for illegal activity, fraud, or to evade restrictions.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">4. No warranty</h2>
          <p className="text-pp-muted">
            The service is provided “as is.” We do not guarantee uninterrupted
            availability, RPC uptime, or third-party name resolution.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">5. Contact</h2>
          <p className="text-pp-muted">
            Support:{" "}
            <a
              className="font-bold text-pp-ink underline underline-offset-2"
              href="https://t.me/allenrel"
              target="_blank"
              rel="noreferrer"
            >
              Telegram @allenrel
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
