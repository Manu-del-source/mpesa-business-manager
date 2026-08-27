/**
 * Auth module — re-exports from tenant.ts for backward compatibility.
 *
 * All existing code that imports from "@/lib/auth" continues to work
 * unchanged. New code should import directly from "@/lib/tenant" for
 * access to TenantContext.
 */
import "server-only";

export {
  type SessionUser,
  type AppContext,
  type TenantContext,
  TenantAccessDeniedError,
  DEMO_SESSION_COOKIE,
  DEMO_USER_ID,
  DEMO_ORG_SLUG,
  ACTIVE_TENANT_COOKIE,
  ACTIVE_ENVIRONMENT_COOKIE,
  parseEnvironmentCookie,
  getDemoUser,
  getCurrentUser,
  requireUser,
  requireAppContext,
  resolveTenantContext,
  requireTenantContext,
  requireTenantContextWithEnvironment,
  resolveTenantForOrg,
} from "@/lib/tenant";
