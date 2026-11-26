import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";
import { COMPANY_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "@/lib/session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function startSession(user: { id: string; role: string; name: string }) {
  const token = await signSession({ sub: user.id, role: user.role, name: user.name });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export const getSessionUser = cache(async () => {
  const store = await cookies();
  const claims = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      memberships: { select: { company: true }, orderBy: { company: { name: "asc" } } },
    },
  });
  if (!user || !user.active) return null;
  return user;
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export interface AppContext {
  user: SessionUser;
  company: Company;
  companies: Company[];
}

export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const companies = user.memberships.map((m) => m.company);
  if (companies.length === 0) return null;
  const store = await cookies();
  const preferred = store.get(COMPANY_COOKIE)?.value;
  const company = companies.find((c) => c.id === preferred) ?? companies[0];
  return { user, company, companies };
});

/** For Server Components: redirects to /login when unauthenticated. */
export async function requirePageContext(permission?: Permission): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  if (permission && !can(ctx.user.role, permission)) redirect("/dashboard?forbidden=1");
  return ctx;
}

/** For Server Actions and Route Handlers: throws an AppError (401 / 403). */
export async function requireActionContext(permission?: Permission): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) throw new AppError("Session expirée : veuillez vous reconnecter.", 401);
  if (permission && !can(ctx.user.role, permission)) {
    throw new AppError("Vous n'avez pas les droits nécessaires pour cette action.", 403);
  }
  return ctx;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return h.get("x-real-ip");
}
