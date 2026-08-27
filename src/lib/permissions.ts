/**
 * Permission registry — the SINGLE SOURCE OF TRUTH for every permission in
 * the platform and the default grants per TenantRole.
 *
 * This module is intentionally dependency-free (no `server-only`, no Prisma)
 * so it can be imported by:
 *   - runtime RBAC                (src/lib/rbac.ts)
 *   - the database seed           (prisma/seed.ts)
 *   - API key scope validation    (src/lib/api-keys.ts)
 *   - tests                       (src/lib/__tests__/*)
 *
 * Do NOT duplicate these definitions anywhere else. If you add a permission,
 * add it here once, decide which roles get it below, and update the tests.
 */

// ---------------------------------------------------------------------------
// Permission registry
// ---------------------------------------------------------------------------

/**
 * All permissions in the system, organized by domain: `<domain>:<action>`.
 * These canonical strings are stored in the Permission table, granted to API
 * keys as scopes, and checked by authorization helpers.
 */
export const PERMISSIONS = {
  // Payments
  "payments:create": "payments:create",
  "payments:read": "payments:read",
  "payments:refund": "payments:refund",
  "payments:cancel": "payments:cancel",

  // Payouts
  "payouts:create": "payouts:create",
  "payouts:read": "payouts:read",
  "payouts:approve": "payouts:approve",

  // Ledger
  "ledger:read": "ledger:read",
  "ledger:post": "ledger:post",

  // Reconciliation
  "reconciliation:read": "reconciliation:read",
  "reconciliation:run": "reconciliation:run",

  // Webhooks
  "webhooks:read": "webhooks:read",
  "webhooks:manage": "webhooks:manage",

  // API Keys
  "api-keys:read": "api-keys:read",
  "api-keys:manage": "api-keys:manage",

  // Provider connections
  "providers:read": "providers:read",
  "providers:manage": "providers:manage",

  // Settings
  "settings:read": "settings:read",
  "settings:manage": "settings:manage",

  // Members
  "members:read": "members:read",
  "members:manage": "members:manage",

  // Audit
  "audit:read": "audit:read",

  // Usage
  "usage:read": "usage:read",

  // POS (legacy business manager)
  "pos:sales": "pos:sales",
  "pos:inventory": "pos:inventory",
  "pos:customers": "pos:customers",
  "pos:expenses": "pos:expenses",
  "pos:reports": "pos:reports",
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Every valid permission string (sorted for stable iteration). */
export const ALL_PERMISSIONS: readonly Permission[] = Object.keys(
  PERMISSIONS,
).sort() as Permission[];

const VALID_PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Is the given string a known permission? */
export function isValidPermission(value: string): value is Permission {
  return VALID_PERMISSION_SET.has(value);
}

/**
 * Validate a list of scope strings against the registry.
 * Returns the invalid entries (empty array means all valid).
 */
export function invalidPermissions(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => !VALID_PERMISSION_SET.has(scope));
}

/**
 * Filter an arbitrary list of strings down to known permissions.
 * Unknown strings never enter an authorization context.
 */
export function filterValidPermissions(
  scopes: readonly string[],
): Permission[] {
  return scopes.filter(isValidPermission);
}

// ---------------------------------------------------------------------------
// Default role → permission mapping
// ---------------------------------------------------------------------------

/**
 * Built-in role mappings applied during seed and when a new TenantMember is
 * created with a default role. The DB Role/Permission tables can override
 * these defaults per deployment (seeding replaces the stored set with these
 * values — see seedRolesAndPermissions), but the defaults here guarantee
 * correct behavior even without seeding.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<TenantRoleName, readonly Permission[]>
> = {
  OWNER: ALL_PERMISSIONS,

  ADMIN: [
    "payments:create",
    "payments:read",
    "payments:refund",
    "payments:cancel",
    "payouts:create",
    "payouts:read",
    "payouts:approve",
    "ledger:read",
    "ledger:post",
    "reconciliation:read",
    "reconciliation:run",
    "webhooks:read",
    "webhooks:manage",
    "api-keys:read",
    "api-keys:manage",
    "providers:read",
    "providers:manage",
    "settings:read",
    "settings:manage",
    "members:read",
    "audit:read",
    "usage:read",
    "pos:sales",
    "pos:inventory",
    "pos:customers",
    "pos:expenses",
    "pos:reports",
  ],

  DEVELOPER: [
    "payments:create",
    "payments:read",
    "ledger:read",
    "reconciliation:read",
    "webhooks:read",
    "webhooks:manage",
    "api-keys:read",
    "api-keys:manage",
    "providers:read",
    "audit:read",
    "pos:sales",
    "pos:inventory",
    "pos:customers",
  ],

  FINANCE: [
    "payments:create",
    "payments:read",
    "payments:refund",
    "payouts:create",
    "payouts:read",
    "payouts:approve",
    "ledger:read",
    "ledger:post",
    "reconciliation:read",
    "reconciliation:run",
    "audit:read",
    "usage:read",
    "pos:sales",
    "pos:reports",
  ],

  VIEWER: [
    "payments:read",
    "ledger:read",
    "reconciliation:read",
    "audit:read",
    "usage:read",
    "pos:sales",
    "pos:inventory",
    "pos:customers",
    "pos:reports",
  ],
};

/** Role names mirroring the Prisma TenantRole enum (kept in sync via tests). */
export const TENANT_ROLES = [
  "OWNER",
  "ADMIN",
  "DEVELOPER",
  "FINANCE",
  "VIEWER",
] as const;

export type TenantRoleName = (typeof TENANT_ROLES)[number];

/**
 * Map a legacy Organization member role to the closest tenant role.
 * Used only when provisioning a TenantMember for a user's own organization
 * during the legacy→infrastructure transition.
 */
export function tenantRoleForOrgRole(
  orgRole: "OWNER" | "ADMIN" | "STAFF",
): TenantRoleName {
  if (orgRole === "OWNER") return "OWNER";
  if (orgRole === "ADMIN") return "ADMIN";
  return "VIEWER";
}

// ---------------------------------------------------------------------------
// Synchronous permission-set checks
// ---------------------------------------------------------------------------

/** Does the given permission set include the required permission? */
export function hasPermission(
  permissions: readonly Permission[],
  required: Permission,
): boolean {
  return permissions.includes(required);
}

/** Check multiple permissions (all must be present). */
export function hasAllPermissions(
  permissions: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.every((p) => permissions.includes(p));
}

/** Check any of the given permissions (at least one must be present). */
export function hasAnyPermission(
  permissions: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.some((p) => permissions.includes(p));
}
