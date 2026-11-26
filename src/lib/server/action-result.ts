import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import type { ActionResult } from "@/lib/action-types";

export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    const first = error.issues[0];
    return {
      ok: false,
      error: first ? `Données invalides : ${first.path.join(".") || "formulaire"} — ${first.message}` : "Données invalides.",
      fieldErrors,
    };
  }
  if (error instanceof AppError) return { ok: false, error: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = (error.meta?.target as string[] | string | undefined) ?? "";
      return { ok: false, error: `Cette valeur est déjà utilisée (${Array.isArray(target) ? target.join(", ") : target}).` };
    }
    if (error.code === "P2003") return { ok: false, error: "Opération impossible : cet élément est référencé par d'autres données." };
    if (error.code === "P2025") return { ok: false, error: "Élément introuvable ou déjà modifié." };
  }
  console.error("[action] unexpected error", error);
  return { ok: false, error: "Une erreur inattendue est survenue. Réessayez ou contactez l'administrateur." };
}

export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (error) {
    return toActionError(error);
  }
}
