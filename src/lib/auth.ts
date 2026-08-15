import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const DEMO_SESSION_COOKIE = "mbm_demo_session";
export const DEMO_USER_ID = "demo-user";
export const DEMO_ORG_SLUG = "kijani-fresh-foods";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isDemo: boolean;
};

export function getDemoUser(): SessionUser {
  return {
    id: DEMO_USER_ID,
    email: "demo@kijani.local",
    name: "Demo Owner",
    isDemo: true,
  };
}

/** Resolve the signed-in user from Supabase Auth or the demo session cookie. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (isDemoMode()) {
    const store = await cookies();
    const hasSession = store.has(DEMO_SESSION_COOKIE);
    return hasSession ? getDemoUser() : null;
  }

  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    isDemo: false,
  };
}

/** Like getCurrentUser but redirects to /signin when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

export type AppContext = {
  user: SessionUser;
  orgId: string;
  org: {
    id: string;
    name: string;
    slug: string;
    tier: "FREE" | "PRO";
    businessType: string;
  };
  role: "OWNER" | "ADMIN" | "STAFF";
};

/**
 * Resolve the current user's organization membership.
 *
 * In demo mode this returns the seeded demo business (Kijani Fresh Foods).
 * If the user has no organization yet (fresh Supabase sign-up), a personal
 * organization is provisioned automatically so the first sign-in lands on a
 * working dashboard.
 */
export async function requireAppContext(): Promise<AppContext> {
  const user = await requireUser();

  // Demo mode: resolve the seeded demo organization by slug.
  if (isDemoMode()) {
    const org = await prisma.organization.findUnique({
      where: { slug: DEMO_ORG_SLUG },
    });
    if (org) {
      const demoMember = await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: org.id, userId: user.id },
        },
        create: {
          organizationId: org.id,
          userId: user.id,
          role: "OWNER",
          firstName: "Demo",
          lastName: "Owner",
        },
        update: {},
      });
      return {
        user,
        orgId: org.id,
        org: org,
        role: demoMember.role,
      };
    }
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    include: { organization: true },
  });

  if (!member) {
    const org = await prisma.organization.create({
      data: {
        name: user.name ? `${user.name.split(" ")[0]}'s Business` : "My Business",
        slug: `${user.id.slice(0, 8)}-business`,
        businessType: "Retail",
      },
    });
    const owner = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: "OWNER",
        firstName: user.name.split(" ")[0] ?? null,
        lastName: user.name.split(" ")[1] ?? null,
      },
    });
    return { user, orgId: org.id, org, role: owner.role };
  }

  return { user, orgId: member.organizationId, org: member.organization, role: member.role };
}
