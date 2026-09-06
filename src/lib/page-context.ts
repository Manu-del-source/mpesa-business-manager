import "server-only";
import { requireTenantContext } from "@/lib/tenant";
import { resolvePermissions, type Permission } from "@/lib/rbac";

/**
 * Common bootstrap for OMNI console pages: resolves the tenant context and
 * the current member's effective permission set in one place, so each
 * page.tsx doesn't repeat the same two calls.
 *
 * This is a UX convenience only — permissions returned here are used to
 * show/hide/disable actions in the client. The backend re-checks every
 * mutating request independently (see `requirePermission` in
 * `src/lib/middleware.ts`), so this list is never a security boundary.
 */
export async function getPageContext() {
  const ctx = await requireTenantContext();
  const permissions = await resolvePermissions(ctx.tenantRole);
  return { ctx, permissions: permissions as Permission[] };
}
