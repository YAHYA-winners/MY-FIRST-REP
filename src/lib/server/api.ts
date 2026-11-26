import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return jsonError(first ? `${first.path.join(".")} : ${first.message}` : "Requête invalide.", 422, {
      issues: error.issues,
    });
  }
  if (error instanceof AppError) return jsonError(error.message, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return jsonError("Doublon : cet enregistrement existe déjà.", 409);
    if (error.code === "P2025") return jsonError("Élément introuvable.", 404);
  }
  console.error("[api] unexpected error", error);
  return jsonError("Erreur interne du serveur.", 500);
}
