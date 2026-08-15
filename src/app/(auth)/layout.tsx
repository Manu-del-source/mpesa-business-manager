import Link from "next/link";
import { BarChart3, Package, ShieldCheck, Smartphone } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const dynamic = "force-dynamic";

const PERKS = [
  {
    icon: Smartphone,
    title: "M-Pesa STK push payments",
    desc: "Collect money straight from your customers' phones and reconcile every shilling.",
  },
  {
    icon: BarChart3,
    title: "Live profit & cash flow",
    desc: "Sales, expenses and M-Pesa in one dashboard that updates the moment a sale lands.",
  },
  {
    icon: Package,
    title: "Stock that never runs out",
    desc: "Low-stock alerts before you lose a sale on your best sellers.",
  },
  {
    icon: ShieldCheck,
    title: "Private & secure",
    desc: "Your business data stays yours — bank-grade auth and encryption.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden border-r border-border bg-card/40 lg:flex lg:flex-col lg:justify-between">
        <div className="hero-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-brand-700/10 blur-3xl" />

        <div className="relative flex items-center p-8">
          <Logo />
        </div>

        <div className="relative max-w-lg px-8">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            Run your whole business on{" "}
            <span className="bg-gradient-to-r from-brand-400 to-brand-300 bg-clip-text text-transparent">
              M-Pesa
            </span>
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The all-in-one manager for Kenyan dukas, shops and SMEs — sales, M-Pesa,
            inventory, customers and expenses.
          </p>

          <ul className="mt-8 space-y-4">
            {PERKS.map((perk) => (
              <li key={perk.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                  <perk.icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{perk.title}</span>
                  <span className="block text-xs text-muted-foreground">{perk.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 border-t border-border p-8 text-xs text-muted-foreground">
          <span className="flex -space-x-1.5">
            {["G", "D", "A", "P"].map((letter, i) => (
              <span
                key={letter}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-card bg-secondary text-[10px] font-semibold"
                style={{ zIndex: 4 - i }}
              >
                {letter}
              </span>
            ))}
          </span>
          <span>Trusted by 2,000+ Kenyan SMEs</span>
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
