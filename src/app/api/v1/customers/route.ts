import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * GET /v1/customers
 *
 * List customers with payment counts, total volume, and activity.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const search = url.searchParams.get("search");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  // Query customers from Organization/Payment database
  // Match by tenant organizations
  const org = await prisma.organization.findFirst({
    where: { tenantId: ctx.tenant.id },
  });

  // No organization for this tenant yet → no customers. Never fall through
  // to an unscoped query, which would list every tenant's customers.
  if (!org) {
    return Response.json({
      data: [],
      meta: { requestId: ctx.requestId, environment: ctx.environment },
    });
  }

  const where: Record<string, unknown> = { organizationId: org.id };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    include: {
      sales: {
        select: {
          id: true,
          total: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Also query unique customer phones from payments if customer table is small
  const paymentsByPhone = await prisma.payment.groupBy({
    by: ["phone", "customerName"],
    where: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
      phone: { not: null },
    },
    _sum: { amountMinor: true },
    _count: { id: true },
    _max: { createdAt: true },
  });

  const existingPhones = new Set(customers.map((c) => c.phone).filter(Boolean));

  // Merge customer table with payment customer aggregation
  const formattedCustomers = customers.map((c) => {
    const totalSales = c.sales.reduce((sum, s) => sum + Number(s.total), 0);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      location: c.location,
      notes: c.notes,
      paymentCount: c.sales.length,
      totalVolumeMinor: (BigInt(Math.round(totalSales * 100))).toString(),
      lastActivity: c.sales[0]?.createdAt.toISOString() || c.updatedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    };
  });

  for (const p of paymentsByPhone) {
    if (p.phone && !existingPhones.has(p.phone)) {
      formattedCustomers.push({
        id: `cust_${Buffer.from(p.phone).toString("hex").slice(0, 10)}`,
        name: p.customerName || `Customer (${p.phone.slice(-4)})`,
        phone: p.phone,
        email: null,
        location: null,
        notes: null,
        paymentCount: p._count.id,
        totalVolumeMinor: (p._sum.amountMinor ?? 0n).toString(),
        lastActivity: p._max.createdAt?.toISOString() || new Date().toISOString(),
        createdAt: p._max.createdAt?.toISOString() || new Date().toISOString(),
      });
    }
  }

  return Response.json({
    data: formattedCustomers,
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}

/**
 * POST /v1/customers
 *
 * Create a new customer profile.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:create"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:create");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid customer data.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  let org = await prisma.organization.findFirst({
    where: { tenantId: ctx.tenant.id },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: ctx.tenant.name,
        slug: ctx.tenant.slug,
        tenantId: ctx.tenant.id,
      },
    });
  }

  const customer = await prisma.customer.create({
    data: {
      organizationId: org.id,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  return Response.json(
    {
      data: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        location: customer.location,
        notes: customer.notes,
        createdAt: customer.createdAt.toISOString(),
      },
      meta: { requestId: ctx.requestId },
    },
    { status: 201 }
  );
}
