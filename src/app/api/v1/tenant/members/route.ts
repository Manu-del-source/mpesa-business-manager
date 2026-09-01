import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import { resolvePermissions, PERMISSIONS } from "@/lib/rbac";
import { z } from "zod";
import type { TenantRole } from "@/generated/prisma";

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "DEVELOPER", "FINANCE", "VIEWER"]),
});

/**
 * GET /v1/tenant/members
 *
 * List tenant members with roles and permissions matrix.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["members:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "members:read");
  if (permErr) return permErr;

  const members = await prisma.tenantMember.findMany({
    where: { tenantId: ctx.tenant.id },
    orderBy: { createdAt: "asc" },
  });

  const formattedMembers = await Promise.all(
    members.map(async (m) => {
      const perms = await resolvePermissions(m.role);
      return {
        id: m.id,
        userId: m.userId,
        email: m.userId === "demo-user" ? "demo@omni.local" : `${m.userId.slice(0, 8)}@domain.com`,
        role: m.role,
        permissions: perms,
        createdAt: m.createdAt.toISOString(),
      };
    })
  );

  return Response.json({
    data: formattedMembers,
    meta: {
      requestId: ctx.requestId,
      availableRoles: ["OWNER", "ADMIN", "DEVELOPER", "FINANCE", "VIEWER"],
      allPermissions: Object.keys(PERMISSIONS),
    },
  });
}

/**
 * POST /v1/tenant/members
 *
 * Add / invite a team member to the tenant with a specific role.
 * Requires `members:manage` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["members:manage"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "members:manage");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = inviteMemberSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid member invite data.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  // Create a tenant member record
  const mockUserId = `usr_${parsed.data.email.split("@")[0]}_${Date.now().toString(36).slice(-4)}`;
  const member = await prisma.tenantMember.create({
    data: {
      tenantId: ctx.tenant.id,
      userId: mockUserId,
      role: parsed.data.role as TenantRole,
    },
  });

  const perms = await resolvePermissions(member.role);

  return Response.json(
    {
      data: {
        id: member.id,
        userId: member.userId,
        email: parsed.data.email,
        role: member.role,
        permissions: perms,
        createdAt: member.createdAt.toISOString(),
      },
      meta: { requestId: ctx.requestId },
    },
    { status: 201 }
  );
}
