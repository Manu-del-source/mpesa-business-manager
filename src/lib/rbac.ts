import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, TenantRole } from "@/generated/prisma/client";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  TENANT_ROLES,
  hasAllPermissions,
  isValidPermission,
  type Permission,
} from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Re-exports — the registry in src/lib/permissions.ts is the single source of
// truth. Consumers can import from either module.
// ---------------------------------------------------------------------------

export {
  PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  TENANT_ROLES,
  isValidPermission,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from "@/lib/permissions";
export type { Permission, TenantRoleName } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Permission resolution
// ---------------------------------------------------------------------------

/**
 * Prisma "known error" codes that mean the Role/Permission tables do not
 * exist yet (bootstrap condition on a database that has not been migrated or
 * seeded). These are the ONLY database conditions for which we fall back to
 * the built-in defaults — every other database failure must DENY access.
 */
const MISSING_TABLE_PRISMA_CODES = new Set(["P2021", "P2022"]);

function isMissingTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    MISSING_TABLE_PRISMA_CODES.has((err as { code: string }).code)
  );
}

/**
 * Resolve the effective permissions for a TenantRole.
 *
 * Checks the DB Role/Permission tables first; falls back to the built-in
 * defaults ONLY when the tables do not exist yet (bootstrap).
 *
 * FAILS CLOSED: any unexpected database error (connection failure, timeout,
 * corruption…) is rethrown so the caller denies access. Authorization must
 * never silently fall back to broad default permissions when the database is
 * unhealthy.
 */
export async function resolvePermissions(
  role: TenantRole,
): Promise<Permission[]> {
  if (!(TENANT_ROLES as readonly string[]).includes(role)) {
    // Unknown role — no permissions at all.
    return [];
  }

  let dbRole: { permissions: { name: string }[] } | null = null;
  try {
    dbRole = await prisma.role.findUnique({
      where: { name: role },
      select: { permissions: { select: { name: true } } },
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      // Bootstrap condition: tables don't exist yet. Using the built-in
      // defaults here is safe because the defaults are the only definition
      // that has ever applied to this database.
      return [...DEFAULT_ROLE_PERMISSIONS[role]];
    }
    // Unexpected database failure — DENY (fail closed).
    throw new Error(
      `Permission resolution failed for role ${role}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (dbRole && dbRole.permissions.length > 0) {
    // Only known permission names enter the result — a stale/invalid row in
    // the join table can never grant an unknown permission.
    return dbRole.permissions
      .map((p) => p.name)
      .filter(isValidPermission)
      .sort();
  }

  // Role row missing or has no permissions granted: use built-in defaults.
  // (seedRolesAndPermissions replaces the stored set with the defaults, so
  // a healthy database converges to the canonical grants.)
  return [...DEFAULT_ROLE_PERMISSIONS[role]];
}

/**
 * Resolve permissions and require a specific one. Throws (denies) when the
 * permission is absent or the database lookup fails.
 */
export async function requirePermissions(
  role: TenantRole,
  required: Permission | Permission[],
): Promise<Permission[]> {
  const permissions = await resolvePermissions(role);
  const needed = Array.isArray(required) ? required : [required];
  if (!hasAllPermissions(permissions, needed)) {
    throw new PermissionDeniedError(role, needed, permissions);
  }
  return permissions;
}

/** Thrown when a role lacks a required permission (or resolution failed). */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly role: TenantRole,
    public readonly required: Permission[],
    public readonly granted: Permission[],
  ) {
    super(
      `Role ${role} is not authorized for ${required.join(", ")} ` +
        `(granted: ${granted.join(", ") || "none"}).`,
    );
    this.name = "PermissionDeniedError";
  }
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed the Permission and Role tables with the canonical data from
 * src/lib/permissions.ts. Safe to re-run: each role's permission set is
 * REPLACED with the current definition (so removing a permission from the
 * registry actually revokes it on the next seed run).
 */
export async function seedRolesAndPermissions(): Promise<{
  permissions: number;
  roles: number;
  rolePermissions: number;
}> {
  return prisma.$transaction(async (tx) => {
    // 1. Upsert all permissions
    for (const name of ALL_PERMISSIONS) {
      await tx.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    }

    // 2. Upsert each role and REPLACE its permission set with the canonical
    //    one (set: [] then connect — guarantees removal of stale grants).
    let rolePermissionsCreated = 0;
    for (const roleName of TENANT_ROLES) {
      const role = await tx.role.upsert({
        where: { name: roleName },
        create: { name: roleName },
        update: {},
      });

      const perms = await tx.permission.findMany({
        where: { name: { in: [...DEFAULT_ROLE_PERMISSIONS[roleName]] } },
        select: { id: true },
      });

      await tx.role.update({
        where: { id: role.id },
        data: {
          permissions: {
            set: perms.map((p) => ({ id: p.id })),
          },
        },
      });
      rolePermissionsCreated += perms.length;
    }

    return {
      permissions: ALL_PERMISSIONS.length,
      roles: TENANT_ROLES.length,
      rolePermissions: rolePermissionsCreated,
    };
  });
}

// Type-only re-export so callers can name transaction client types.
export type { Prisma };
