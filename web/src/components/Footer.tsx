import { ExternalLink } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { LogoMark } from "@/components/Logo";

const AGENT_STORE_URL =
  import.meta.env.VITE_AGENT_STORE_URL ?? "https://agent.croo.network";
const BASESCAN_URL =
  import.meta.env.VITE_BASESCAN_URL ?? "https://sepolia.basescan.org";
const CROO_DOCS_URL = "https://docs.croo.network";
const CONTAINER = "mx-auto w-full max-w-6xl px-6 lg:px-8";

const footerLinks = {
  product: [
    { label: "Split preview", href: "/#preview", external: false },
    { label: "Agent Store", href: AGENT_STORE_URL, external: true },
    { label: "How it works", href: "/#how-it-works", external: false },
  ],
  resources: [
    { label: "CROO Agent Store", href: AGENT_STORE_URL, external: true },
    { label: "CROO docs", href: CROO_DOCS_URL, external: true },
    { label: "BaseScan", href: BASESCAN_URL, external: true },
    { label: "Base", href: "https://base.org", external: true },
  ],
};

function FooterLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      {external && <ExternalLink className="h-3 w-3 opacity-60" />}
    </a>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-background">
      <div className={`${CONTAINER} py-12`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4 sm:col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-semibold tracking-tight">Remifi</span>
            </div>
            <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
              Remifi is a CROO CAP agent for programmable USDC splits on Base. Describe payment
              rules in plain language, preview allocations, and settle through the Agent Store with
              on chain proof.
            </p>
            <p className="text-xs text-muted-foreground">
              Static preview only. Payments are processed through CROO when Remifi is hired.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Product
            </h3>
            <nav className="flex flex-col gap-2">
              {footerLinks.product.map((link) => (
                <FooterLink key={link.label} {...link} />
              ))}
            </nav>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Resources
            </h3>
            <nav className="flex flex-col gap-2">
              {footerLinks.resources.map((link) => (
                <FooterLink key={link.label} {...link} />
              ))}
            </nav>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} Remifi</p>
          <p>USDC on Base, CAP integrated, demo preview</p>
        </div>
      </div>
    </footer>
  );
}
