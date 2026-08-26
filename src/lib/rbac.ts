import "server-only";
import { prisma } from "@/lib/prisma";
import type { TenantRole } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Permission constants
// ---------------------------------------------------------------------------

/**
 * All permissions in the system. Organized by domain:
 *   `<domain>:<action>`
 *
 * These are the canonical strings stored in the Permission table and
 * checked by authorization helpers.
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

// ---------------------------------------------------------------------------
// Default role → permission mapping
// ---------------------------------------------------------------------------

/**
 * Built-in role mappings. These are applied during seed and when a new
 * TenantMember is created. The DB Role/Permission tables can override
 * these defaults per-tenant, but the defaults ensure correct behavior
 * even without seeding.
 */
const DEFAULT_ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  OWNER: Object.keys(PERMISSIONS) as Permission[],

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
    "members:manage",
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

// ---------------------------------------------------------------------------
// Permission resolution
// ---------------------------------------------------------------------------

/**
 * Resolve permissions for a TenantRole. Checks the DB Role/Permission
 * tables first; falls back to built-in defaults if the tables aren't
 * seeded yet.
 */
export async function resolvePermissions(role: TenantRole): Promise<Permission[]> {
  // Try DB-backed roles first
  try {
    const dbRole = await prisma.role.findUnique({
      where: { name: role },
      include: { permissions: true },
    });

    if (dbRole && dbRole.permissions.length > 0) {
      return dbRole.permissions.map((p) => p.name as Permission);
    }
  } catch {
    // Tables might not exist yet — fall through to defaults
  }

  // Fall back to built-in defaults
  return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Fast synchronous check: does the given permission set include the
 * required permission? Used after resolvePermissions() to avoid
 * repeated DB calls.
 */
export function hasPermission(
  permissions: Permission[],
  required: Permission,
): boolean {
  return permissions.includes(required);
}

/**
 * Check multiple permissions (all must be present).
 */
export function hasAllPermissions(
  permissions: Permission[],
  required: Permission[],
): boolean {
  return required.every((p) => permissions.includes(p));
}

/**
 * Check any of the given permissions (at least one must be present).
 */
export function hasAnyPermission(
  permissions: Permission[],
  required: Permission[],
): boolean {
  return required.some((p) => permissions.includes(p));
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed the Permission and Role tables with default data.
 * Safe to re-run (idempotent).
 */
export async function seedRolesAndPermissions(): Promise<{
  permissions: number;
  roles: number;
  rolePermissions: number;
}> {
  let permissionsCreated = 0;
  let rolesCreated = 0;
  let rolePermissionsCreated = 0;

  // Upsert all permissions
  for (const name of Object.keys(PERMISSIONS)) {
    const result = await prisma.permission.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    if (result) permissionsCreated++;
  }

  // Upsert all roles with their default permissions
  for (const [roleName, permNames] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName as TenantRole },
      create: { name: roleName as TenantRole },
      update: {},
    });

    // Connect permissions to role
    for (const permName of permNames) {
      const perm = await prisma.permission.findUnique({
        where: { name: permName },
      });
      if (perm) {
        await prisma.role.update({
          where: { id: role.id },
          data: {
            permissions: {
              connect: { id: perm.id },
            },
          },
        });
        rolePermissionsCreated++;
      }
    }

    rolesCreated++;
  }

  return {
    permissions: permissionsCreated,
    roles: rolesCreated,
    rolePermissions: rolePermissionsCreated,
  };
}
