import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/customers/:id
 *
 * Customer detail view with transaction history.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const { id } = await params;

  // Customers live on the POS Organization that belongs to this tenant.
  // Scoping the lookup by organization.tenantId prevents reading another
  // tenant's customer by guessing an id.
  const customer = await prisma.customer.findFirst({
    where: { id, organization: { tenantId: ctx.tenant.id } },
  });

  if (!customer) {
    return apiError({ code: "NOT_FOUND", message: "Customer not found.", status: 404 });
  }

  let payments: Array<{
    id: string;
    reference: string | null;
    amountMinor: bigint;
    currency: string;
    status: string;
    createdAt: Date;
  }> = [];

  if (customer.phone) {
    payments = await prisma.payment.findMany({
      where: {
        applicationId: ctx.application.id,
        environment: ctx.environment,
        phone: customer.phone,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        reference: true,
        amountMinor: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    });
  }

  return Response.json({
    data: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      location: customer.location,
      notes: customer.notes,
      loyaltyPoints: customer.loyaltyPoints,
      createdAt: customer.createdAt.toISOString(),
      payments: payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        amountMinor: p.amountMinor.toString(),
        currency: p.currency,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}
