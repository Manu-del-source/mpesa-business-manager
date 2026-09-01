import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_TENANT_COOKIE, ACTIVE_ENVIRONMENT_COOKIE } from "@/lib/tenant";
import { z } from "zod";

const switchSchema = z.object({
  tenantSlug: z.string().optional(),
  environment: z.enum(["SANDBOX", "LIVE"]).optional(),
});

/**
 * POST /v1/tenant/switch
 *
 * Switch active tenant or environment in session cookies.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = switchSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid switch parameters" }, { status: 400 });
  }

  const cookieStore = await cookies();

  if (parsed.data.tenantSlug) {
    cookieStore.set(ACTIVE_TENANT_COOKIE, parsed.data.tenantSlug, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  }

  if (parsed.data.environment) {
    cookieStore.set(ACTIVE_ENVIRONMENT_COOKIE, parsed.data.environment, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  }

  return Response.json({
    ok: true,
    activeTenantSlug: parsed.data.tenantSlug ?? cookieStore.get(ACTIVE_TENANT_COOKIE)?.value ?? null,
    activeEnvironment: parsed.data.environment ?? cookieStore.get(ACTIVE_ENVIRONMENT_COOKIE)?.value ?? "SANDBOX",
  });
}
