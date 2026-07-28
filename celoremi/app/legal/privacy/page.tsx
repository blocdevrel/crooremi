import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · Remifi",
  description: "Privacy Policy for Remifi on Celo / MiniPay.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold text-pp-muted">
        <Link href="/" className="underline underline-offset-2">
          ← Remifi
        </Link>
      </p>
      <h1 className="mt-4 text-3xl font-extrabold tracking-[-0.04em]">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm font-medium text-pp-muted">
        Last updated: July 27, 2026 · Operated by Remifi (not MiniPay / Opera).
      </p>

      <div className="mt-8 grid gap-5 text-[0.95rem] font-medium leading-relaxed">
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">1. What we process</h2>
          <p className="text-pp-muted">
            Wallet addresses you connect, policy text you submit, payout amounts,
            job IDs, and on-chain transaction hashes. Public blockchain data is
            visible on Celoscan and is not private.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">2. How we use it</h2>
          <p className="text-pp-muted">
            To run Remifi (create policies, execute splits, show proof), improve
            reliability, and meet hackathon / attribution requirements (ERC-8021
            tags). We do not sell personal data.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">3. Storage</h2>
          <p className="text-pp-muted">
            Policy and job records may be stored in our Postgres database.
            Hosting providers (e.g. Railway) process request logs. MiniPay wallet
            keys never leave your device / MiniPay app.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">4. Third parties</h2>
          <p className="text-pp-muted">
            Celo RPC, Celoscan, ENS/Base name resolvers, and optional x402
            facilitator may receive addresses and amounts needed to complete a
            request.
          </p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-lg font-extrabold">5. Contact</h2>
          <p className="text-pp-muted">
            Questions:{" "}
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
