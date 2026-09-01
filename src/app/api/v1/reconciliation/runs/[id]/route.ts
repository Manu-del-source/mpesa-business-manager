import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/reconciliation/runs/:id
 *
 * Detailed view of a reconciliation run including matched items, discrepancies, and exceptions.
 * Requires `reconciliation:read` scope.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["reconciliation:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "reconciliation:read");
  if (permErr) return permErr;

  const { id } = await params;

  const run = await prisma.reconciliationRun.findFirst({
    where: {
      id,
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
    include: {
      items: {
        include: {
          payment: {
            select: {
              id: true,
              reference: true,
              amountMinor: true,
              phone: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      exceptions: {
        include: {
          payment: {
            select: {
              id: true,
              reference: true,
              amountMinor: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!run) {
    return apiError({ code: "NOT_FOUND", message: "Reconciliation run not found.", status: 404 });
  }

  return Response.json({
    data: {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      totalChecked: run.totalChecked,
      matched: run.matched,
      discrepancies: run.discrepancies,
      error: run.error,
      items: run.items.map((item) => ({
        id: item.id,
        paymentId: item.paymentId,
        paymentReference: item.payment?.reference ?? null,
        paymentAmountMinor: item.payment?.amountMinor?.toString() ?? null,
        externalId: item.externalId,
        internalStatus: item.internalStatus,
        externalStatus: item.externalStatus,
        match: item.match,
        discrepancyType: item.discrepancyType,
        details: item.details,
        createdAt: item.createdAt.toISOString(),
      })),
      exceptions: run.exceptions.map((ex) => ({
        id: ex.id,
        paymentId: ex.paymentId,
        paymentReference: ex.payment?.reference ?? null,
        type: ex.type,
        severity: ex.severity,
        description: ex.description,
        suggestedAction: ex.suggestedAction,
        resolved: ex.resolved,
        resolvedAt: ex.resolvedAt?.toISOString() ?? null,
        resolvedBy: ex.resolvedBy,
        resolution: ex.resolution,
        createdAt: ex.createdAt.toISOString(),
      })),
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}
