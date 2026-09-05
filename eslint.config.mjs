import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // "Fetch on mount / dependency change" via useEffect is the
      // established client-component data-loading pattern used throughout
      // this codebase (OmniDashboardView and every Omni*View component).
      // Downgraded from error to warning — migrating this app to a
      // data-fetching library (React Query, `use()` + Suspense, etc.) to
      // satisfy the React Compiler's stricter preference is a real
      // improvement but a separate, larger change than this integration.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
