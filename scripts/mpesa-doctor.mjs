/**
 * M-Pesa pre-flight doctor.
 *
 * Checks everything that can be verified WITHOUT contacting Safaricom, so the
 * first real sandbox test fails for real reasons rather than configuration
 * mistakes. Run it immediately before your first Daraja sandbox attempt:
 *
 *   node --import tsx --conditions=react-server scripts/mpesa-doctor.mjs
 *
 * Optionally verify a specific organization's saved credentials:
 *
 *   ... scripts/mpesa-doctor.mjs --org <organizationId|slug>
 *
 * It NEVER prints secret values, and it never sends anything to Safaricom.
 */
import "dotenv/config";

const argv = process.argv.slice(2);
const orgArg = argv.includes("--org") ? argv[argv.indexOf("--org") + 1] : null;

const { PrismaClient } = await import("../src/generated/prisma/client.ts");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { checkCallbackUrl, defaultCallbackUrl, getSafeMpesaConfig } = await import(
  "../src/lib/mpesa/config.ts"
);
const { encryptionEnabled } = await import("../src/lib/mpesa/crypto.ts");

let problems = 0;
let warnings = 0;

const ok = (m) => console.log(`  ✅ ${m}`);
const warn = (m) => {
  warnings++;
  console.log(`  ⚠️  ${m}`);
};
const bad = (m) => {
  problems++;
  console.log(`  ❌ ${m}`);
};

const has = (k) => Boolean(process.env[k]?.trim());

console.log("\n═══ M-Pesa pre-flight doctor ═══");

// ---------------------------------------------------------------------------
console.log("\n1. Core environment");
if (has("DATABASE_URL")) ok("DATABASE_URL is set");
else bad("DATABASE_URL is missing");

const demo = process.env.DEMO_MODE === "true";
if (demo) {
  warn(
    'DEMO_MODE="true" — STK push is SIMULATED. Set DEMO_MODE="false" to reach Safaricom.',
  );
} else {
  ok('DEMO_MODE="false" — real Daraja requests are enabled');
}

if (process.env.DARAJA_BASE_URL_OVERRIDE?.trim()) {
  warn(
    `DARAJA_BASE_URL_OVERRIDE is set (${process.env.DARAJA_BASE_URL_OVERRIDE}) — sandbox traffic goes to this host, NOT Safaricom. Unset it for a real test.`,
  );
} else {
  ok("DARAJA_BASE_URL_OVERRIDE is unset — sandbox traffic goes to Safaricom");
}

// ---------------------------------------------------------------------------
console.log("\n2. Callback URL (what Safaricom must reach)");
const cbUrl = defaultCallbackUrl();
console.log(`     ${cbUrl}`);
const cb = checkCallbackUrl(cbUrl);
if (cb.ok) {
  ok("Callback URL is public HTTPS and correctly pathed");
} else {
  bad(`${cb.message}`);
  if (cb.problem === "NOT_HTTPS" || cb.problem === "NOT_PUBLIC") {
    console.log(
      "       Fix: start a tunnel (e.g. `ngrok http 3000`) and set\n" +
        '            MPESA_CALLBACK_BASE_URL="https://<your-subdomain>.ngrok-free.app"',
    );
  }
}

if (has("MPESA_CALLBACK_TOKEN")) {
  ok("MPESA_CALLBACK_TOKEN is set — callbacks without it are rejected");
} else {
  warn(
    "MPESA_CALLBACK_TOKEN is not set — the callback endpoint accepts any caller. Fine for a first sandbox test; set it before production.",
  );
}

// ---------------------------------------------------------------------------
console.log("\n3. Secret handling");
if (encryptionEnabled()) {
  ok("MPESA_CREDENTIALS_KEY is set — secrets encrypted at rest (AES-256-GCM)");
} else {
  warn(
    "MPESA_CREDENTIALS_KEY is not set — Daraja secrets are stored as plaintext. Acceptable for sandbox, REQUIRED for production.",
  );
}

const publicLeaks = Object.keys(process.env).filter(
  (k) =>
    k.startsWith("NEXT_PUBLIC_") &&
    /DARAJA|MPESA|SECRET|PASSKEY|CONSUMER|TOKEN/i.test(k),
);
if (publicLeaks.length === 0) {
  ok("No M-Pesa value is exposed through a NEXT_PUBLIC_* variable");
} else {
  bad(`These NEXT_PUBLIC_* vars must be renamed: ${publicLeaks.join(", ")}`);
}

// ---------------------------------------------------------------------------
console.log("\n4. Reconciliation");
if (has("MPESA_CRON_SECRET")) {
  ok("MPESA_CRON_SECRET is set — /api/mpesa/reconcile is enabled");
} else {
  warn(
    "MPESA_CRON_SECRET is not set — /api/mpesa/reconcile returns 503. Optional for a first test.",
  );
}

// ---------------------------------------------------------------------------
console.log("\n5. Saved Daraja credentials");
if (!has("DATABASE_URL")) {
  warn("Skipped — DATABASE_URL is not set.");
} else {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const orgs = orgArg
      ? await prisma.organization.findMany({
          where: { OR: [{ id: orgArg }, { slug: orgArg }] },
        })
      : await prisma.organization.findMany({ take: 25, orderBy: { createdAt: "asc" } });

    if (orgs.length === 0) {
      warn(orgArg ? `No organization matched "${orgArg}".` : "No organizations found.");
    }

    let anyConfigured = false;
    for (const org of orgs) {
      const cfg = await getSafeMpesaConfig(org.id);
      if (!cfg.configured && !orgArg) continue;
      anyConfigured = true;

      console.log(`\n   ${org.name} (${org.slug})`);
      if (!cfg.configured) {
        bad("No Daraja credentials saved. Configure at /settings/mpesa.");
        continue;
      }
      ok(`Credentials present (source: ${cfg.source})`);
      console.log(`     environment : ${cfg.environment}`);
      console.log(`     shortcode   : ${cfg.shortcode}`);
      console.log(`     consumer key: ${cfg.consumerKeyMasked}`);
      console.log(`     secret/passkey stored: ${cfg.hasConsumerSecret}/${cfg.hasPasskey}`);
      console.log(`     callback    : ${cfg.callbackUrl}`);

      if (cfg.enabled) {
        ok("Enabled");
      } else {
        bad('Disabled — turn on "Enable M-Pesa payments" or pushes stay simulated.');
      }

      if (cfg.environment === "sandbox" && cfg.shortcode !== "174379") {
        warn(
          `Sandbox usually uses shortcode 174379; yours is ${cfg.shortcode}. Only correct if Safaricom issued you a different sandbox shortcode.`,
        );
      }
      if (cfg.environment === "production") {
        warn("Environment is PRODUCTION — this moves real money.");
      }
      if (!cfg.callbackReachable) bad(cfg.callbackWarning ?? "Callback URL unreachable.");
    }

    if (!anyConfigured && !orgArg) {
      warn(
        "No organization has Daraja credentials yet. Sign in as owner/admin and configure at /settings/mpesa.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
console.log("\n═══ Summary ═══");
console.log(`  ${problems} blocking problem(s), ${warnings} warning(s)`);
if (problems === 0) {
  console.log(
    "\n  Configuration looks ready for a Safaricom sandbox attempt.\n" +
      "  NOTE: this checks configuration only. It does NOT prove your credentials\n" +
      "  are valid or that Safaricom can reach your callback — only a real\n" +
      "  sandbox STK push can establish that.\n",
  );
} else {
  console.log("\n  Fix the ❌ items above before attempting a sandbox test.\n");
}
process.exit(problems === 0 ? 0 : 1);
