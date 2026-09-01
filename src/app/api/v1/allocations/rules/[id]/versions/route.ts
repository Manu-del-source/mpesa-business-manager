import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createRuleVersion } from "@/lib/allocations";
import { z } from "zod";

const splitSchema = z.object({
  accountId: z.string().min(1),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
});

const versionSchema = z.object({
  roundingMode: z.enum(["HALF_UP", "HALF_DOWN", "TRUNCATE", "CEIL"]).default("HALF_UP"),
  splits: z.array(splitSchema).min(1),
});

/**
 * POST /v1/allocations/rules/:id/versions
 *
 * Create a new version for an existing allocation rule.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:post"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:post");
  if (permErr) return permErr;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = versionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid version splits.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    // The rule id is resolved inside the caller's application + environment,
    // so another tenant's rule can never be versioned through this endpoint.
    const version = await createRuleVersion(
      id,
      ctx.application.id,
      ctx.environment,
      parsed.data.splits,
      parsed.data.roundingMode,
    );
    return Response.json(
      {
        data: {
          id: version.id,
          version: version.version,
          splits: version.splits,
          roundingMode: version.roundingMode,
          createdAt: version.createdAt.toISOString(),
        },
        meta: { requestId: ctx.requestId },
      },
      { status: 201 }
    );
  } catch (err) {
    return apiError({
      code: "NOT_FOUND",
      message: err instanceof Error ? err.message : "Rule not found.",
      status: 404,
    });
  }
}
