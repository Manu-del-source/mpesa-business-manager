import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Check,
  LineChart,
  Package,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      {/* ------------------------------------------------------------------ */}
      {/* Nav */}
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
            <a href="#testimonials" className="transition-colors hover:text-foreground">Customers</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Button asChild>
                <Link href="/dashboard">
                  Open dashboard <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/signin">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------------------------------------------------------ */}
        {/* Hero */}
        {/* ------------------------------------------------------------------ */}
        <section className="hero-grid relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />
          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="secondary" className="mb-5 rounded-full px-3 py-1">
                <Sparkles className="h-3 w-3 text-brand-400" />
                Built for Kenyan SMEs
              </Badge>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
                Run your whole business on{" "}
                <span className="bg-gradient-to-r from-brand-400 to-brand-300 bg-clip-text text-transparent">
                  M-Pesa
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
                Sales, M-Pesa transactions, expenses, inventory and customers — one
                dashboard for your duka, shop or business. Accept STK push payments,
                track stock, and know exactly how your business is performing.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button size="lg" asChild className="w-full sm:w-auto">
                  <Link href="/signup">
                    Start free — no card required <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {isDemoMode()
                  ? "Demo mode: sign in instantly and explore with sample data."
                  : "Free 14-day PRO trial · Cancel anytime"}
              </p>
            </div>

            {/* Dashboard preview mock */}
            <DashboardPreview />
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Stats band */}
        {/* ------------------------------------------------------------------ */}
        <section className="border-y border-border bg-card/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 text-center sm:px-6 md:grid-cols-4">
            {[
              ["KSh 1.2B+", "processed through M-Pesa"],
              ["2,000+", "SMEs across Kenya"],
              ["45,000+", "sales recorded daily"],
              ["99.9%", "uptime"],
            ].map(([stat, label]) => (
              <div key={label}>
                <p className="text-2xl font-bold text-brand-400 sm:text-3xl">{stat}</p>
                <p className="mt-1 text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Features */}
        {/* ------------------------------------------------------------------ */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything your business needs, in one place
            </h2>
            <p className="mt-4 text-muted-foreground">
              Stop juggling M-Pesa statements, notebooks and spreadsheets. M-Pesa
              Business Manager ties every shilling together.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Smartphone,
                title: "M-Pesa STK push",
                desc: "Send payment requests to customers' phones and reconcile every transaction automatically — no manual entry.",
              },
              {
                icon: BarChart3,
                title: "Live dashboard",
                desc: "See today's revenue, profit, expenses and M-Pesa cash flow at a glance — updated the moment a sale lands.",
              },
              {
                icon: Package,
                title: "Inventory that sells itself",
                desc: "Track stock levels, cost prices and margins. Get alerted before you run out of your best sellers.",
              },
              {
                icon: Users,
                title: "Customers, remembered",
                desc: "Build a customer list with phones, loyalty points and purchase history. Reward your regulars.",
              },
              {
                icon: Wallet,
                title: "Expenses, categorised",
                desc: "Record rent, salaries, stock and utilities. See where your money goes with clear category reports.",
              },
              {
                icon: LineChart,
                title: "Reports that make sense",
                desc: "Profit & loss, cash flow and top products — export-ready reports your accountant will love.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-brand-500/40"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* How it works */}
        {/* ------------------------------------------------------------------ */}
        <section id="how-it-works" className="border-y border-border bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                From sale to shilling in seconds
              </h2>
              <p className="mt-4 text-muted-foreground">
                Recording a sale is as fast as serving a customer.
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Ring up the sale",
                  desc: "Pick the items and customer in our lightning-fast till. Prices and stock update automatically.",
                },
                {
                  step: "02",
                  title: "Customer pays with M-Pesa",
                  desc: "Tap “Send STK push” — the customer enters their PIN and pays straight from their phone.",
                },
                {
                  step: "03",
                  title: "Everything reconciles",
                  desc: "The payment is matched to the sale, stock is decremented and your dashboard updates instantly.",
                },
              ].map((s) => (
                <div key={s.step} className="relative">
                  <span className="text-5xl font-bold text-brand-500/20">{s.step}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Pricing */}
        {/* ------------------------------------------------------------------ */}
        <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Simple pricing in KSh
            </h2>
            <p className="mt-4 text-muted-foreground">
              Start free. Upgrade when your business grows.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-8">
              <h3 className="text-lg font-semibold">Free</h3>
              <p className="mt-2 text-3xl font-bold">KSh 0</p>
              <p className="text-sm text-muted-foreground">forever</p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {[
                  "Up to 100 sales per month",
                  "M-Pesa STK push requests",
                  "Inventory for 50 products",
                  "Basic reports",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="mt-8 w-full" asChild>
                <Link href="/signup">Start free</Link>
              </Button>
            </div>

            <div className="relative rounded-lg border border-brand-500/40 bg-card p-8 shadow-[0_0_40px_-12px_var(--color-brand-500)]">
              <Badge variant="success" className="absolute -top-3 right-6">
                Most popular
              </Badge>
              <h3 className="text-lg font-semibold">Pro</h3>
              <p className="mt-2 text-3xl font-bold">
                KSh 1,500<span className="text-base font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-sm text-muted-foreground">per business</p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {[
                  "Unlimited sales & products",
                  "M-Pesa reconciliation & statements",
                  "Advanced reports & P&L",
                  "Multiple staff accounts",
                  "Priority support (WhatsApp)",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-8 w-full" asChild>
                <Link href="/signup">Start 14-day free trial</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Testimonials */}
        {/* ------------------------------------------------------------------ */}
        <section id="testimonials" className="border-y border-border bg-card/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Loved by business owners across Kenya
              </h2>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {[
                {
                  quote:
                    "I used to spend every Sunday balancing my M-Pesa statement against a notebook. Now I just open the app — it's all there.",
                  name: "Grace Wanjiru",
                  role: "Green Grocer, Nakuru",
                },
                {
                  quote:
                    "The STK push is magic. Customers pay without asking for change, and my stock count is always right.",
                  name: "David Otieno",
                  role: "Electronics Shop, Kisumu",
                },
                {
                  quote:
                    "My accountant asked what software I use. She said it's cleaner than anything her other clients use.",
                  name: "Amina Hassan",
                  role: "Boutique Owner, Mombasa",
                },
              ].map((t) => (
                <figure key={t.name} className="rounded-lg border border-border bg-card p-6">
                  <div className="flex gap-0.5 text-brand-400">{"★★★★★"}</div>
                  <blockquote className="mt-4 text-sm leading-relaxed text-foreground/90">
                    “{t.quote}”
                  </blockquote>
                  <figcaption className="mt-4 text-sm">
                    <span className="font-semibold">{t.name}</span>
                    <span className="text-muted-foreground"> — {t.role}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* CTA */}
        {/* ------------------------------------------------------------------ */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="relative overflow-hidden rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/15 via-card to-card p-10 text-center sm:p-16">
            <div className="pointer-events-none absolute -top-20 right-0 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
            <ShieldCheck className="mx-auto h-10 w-10 text-brand-400" />
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Your business deserves better than a notebook
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Join thousands of Kenyan SMEs running their sales, M-Pesa and stock
              from one dashboard. Set up in under 2 minutes.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" asChild className="w-full sm:w-auto">
                <Link href="/signup">
                  Get started free <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Logo />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} M-Pesa Business Manager. Made with ❤️ in Nairobi.
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <Link href="/signin" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dashboard preview (pure CSS mock of the product UI)                        */
/* -------------------------------------------------------------------------- */
function DashboardPreview() {
  const bars = [42, 58, 47, 72, 64, 88, 76, 95, 82, 100, 90, 108];
  const transactions = [
    { name: "Grace W.", method: "M-Pesa", amount: "+ KSh 2,450", color: "text-brand-400" },
    { name: "Walk-in", method: "Cash", amount: "+ KSh 1,200", color: "text-brand-300" },
    { name: "David O.", method: "M-Pesa", amount: "+ KSh 8,900", color: "text-brand-400" },
  ];

  return (
    <div className="mx-auto mt-14 max-w-4xl">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40">
        {/* window chrome */}
        <div className="flex items-center gap-1.5 border-b border-border bg-background/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          <span className="ml-3 hidden rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:block">
            app.mpesabusiness.co.ke/dashboard
          </span>
        </div>

        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_240px]">
          <div className="space-y-4">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Today's sales", "KSh 24,780"],
                ["This month", "KSh 486,200"],
                ["M-Pesa in", "KSh 312,450"],
                ["Profit", "KSh 98,340"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-background/50 p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-bold tracking-tight sm:text-base">{value}</p>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="rounded-lg border border-border bg-background/50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Revenue — last 12 weeks</p>
                <Badge variant="success">+18%</Badge>
              </div>
              <div className="mt-4 flex h-32 items-end gap-1.5 sm:gap-2">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-gradient-to-t from-brand-600/70 to-brand-400/90"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Recent transactions */}
          <div className="rounded-lg border border-border bg-background/50 p-4">
            <div className="flex items-center gap-2">
              <ReceiptText className="h-3.5 w-3.5 text-brand-400" />
              <p className="text-xs font-medium">Recent transactions</p>
            </div>
            <div className="mt-3 space-y-3">
              {transactions.map((t) => (
                <div key={t.name} className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground">{t.method} · just now</p>
                  </div>
                  <span className={`text-xs font-semibold ${t.color}`}>{t.amount}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-md bg-brand-500/10 px-3 py-2 text-[11px] text-brand-400">
              <BellRing className="mr-1 inline h-3 w-3" />
              3 low-stock alerts
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
