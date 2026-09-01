import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createAllocationRule, listAllocationRules } from "@/lib/allocations";
import { z } from "zod";

const splitSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
});

const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  priority: z.number().int().default(0),
  roundingMode: z.enum(["HALF_UP", "HALF_DOWN", "TRUNCATE", "CEIL"]).default("HALF_UP"),
  splits: z.array(splitSchema).min(1),
});

/**
 * GET /v1/allocations/rules
 *
 * List all allocation rules with their versions.
 * Requires `ledger:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:read");
  if (permErr) return permErr;

  const rules = await listAllocationRules(ctx.application.id, ctx.environment);

  return Response.json({
    data: rules.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      active: r.active,
      priority: r.priority,
      versions: r.versions.map((v) => ({
        id: v.id,
        version: v.version,
        splits: v.splits,
        roundingMode: v.roundingMode,
        active: v.active,
        createdAt: v.createdAt.toISOString(),
      })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    meta: { requestId: ctx.requestId, environment: ctx.environment },
  });
}

/**
 * POST /v1/allocations/rules
 *
 * Create a new allocation rule with split definition.
 * Requires `ledger:post` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:post"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:post");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid allocation rule.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const rule = await createAllocationRule({
      applicationId: ctx.application.id,
      environment: ctx.environment,
      name: parsed.data.name,
      description: parsed.data.description,
      priority: parsed.data.priority,
      splits: parsed.data.splits,
      roundingMode: parsed.data.roundingMode,
    });

    return Response.json(
      {
        data: {
          id: rule.id,
          name: rule.name,
          description: rule.description,
          priority: rule.priority,
          createdAt: rule.createdAt.toISOString(),
        },
        meta: { requestId: ctx.requestId },
      },
      { status: 201 },
    );
  } catch (err) {
    return apiError({
      code: "CONFLICT",
      message: err instanceof Error ? err.message : "Unable to create allocation rule.",
      status: 409,
    });
  }
}
