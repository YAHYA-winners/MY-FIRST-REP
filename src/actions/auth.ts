"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validators";
import { COMPANY_COOKIE } from "@/lib/session";
import { clientIp, endSession, getSessionUser, startSession, verifyPassword } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { AppError } from "@/lib/errors";

export interface LoginState {
  error?: string;
  email?: string;
}

// Basic brute-force protection (per instance). Use a shared store (Redis) when scaling horizontally.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
// Pre-computed bcrypt hash used to keep timing constant when the e-mail is unknown.
const DUMMY_HASH = "$2b$12$tPTd1x31hRxlftNxvZ4dHOmUG8dGIBVCyLWI70uDdOqCve2emtbfO";

function isSafeRedirect(path: string | null): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/login");
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Identifiants invalides.", email };

  const key = `${parsed.data.email}|${(await clientIp()) ?? "local"}`;
  const now = Date.now();
  const bucket = attempts.get(key);
  if (bucket && bucket.resetAt > now && bucket.count >= MAX_ATTEMPTS) {
    return { error: "Trop de tentatives. Réessayez dans quelques minutes.", email };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, name: true, role: true, active: true, passwordHash: true, _count: { select: { memberships: true } } },
  });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.active) {
    const next = bucket && bucket.resetAt > now ? { count: bucket.count + 1, resetAt: bucket.resetAt } : { count: 1, resetAt: now + WINDOW_MS };
    attempts.set(key, next);
    return { error: user && !user.active ? "Compte désactivé. Contactez l'administrateur." : "E-mail ou mot de passe incorrect.", email };
  }
  if (user._count.memberships === 0) {
    return { error: "Votre compte n'est rattaché à aucune société.", email };
  }
  attempts.delete(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession({ id: user.id, role: user.role, name: user.name });

  const next = formData.get("next");
  redirect(isSafeRedirect(typeof next === "string" ? next : null) ? (next as string) : "/dashboard");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function switchCompany(companyId: string) {
  return runAction(async () => {
    const user = await getSessionUser();
    if (!user) throw new AppError("Session expirée.", 401);
    if (!user.memberships.some((m) => m.company.id === companyId)) {
      throw new AppError("Société non autorisée.", 403);
    }
    const store = await cookies();
    store.set(COMPANY_COOKIE, companyId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath("/", "layout");
    return null;
  });
}
