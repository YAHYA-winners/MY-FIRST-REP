import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { requireActionContext } from "@/lib/server/auth";
import { handleApiError, jsonError } from "@/lib/server/api";
import { buildStorageKey, putObject, readUploadedFile, sha256 } from "@/lib/server/storage";
import { SUPPORTED_INVOICE_MIME_TYPES } from "@/lib/gemini-invoice-extractor";

export const runtime = "nodejs";

const MAX_FILES = 20;

export interface UploadedInvoiceDto {
  id: string;
  fileName: string;
  status: string;
  duplicate: boolean;
  error?: string;
}

/** Batch upload of supplier invoices (PDF / images). Extraction is triggered separately per file. */
export async function POST(req: Request) {
  try {
    const { user, company } = await requireActionContext("invoice:import");
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return jsonError("Aucun fichier reçu.", 400);
    if (files.length > MAX_FILES) return jsonError(`${MAX_FILES} fichiers maximum par envoi.`, 400);
    const maxBytes = Number(process.env.MAX_INVOICE_UPLOAD_MB ?? "25") * 1024 * 1024;

    const results: UploadedInvoiceDto[] = [];
    for (const file of files) {
      try {
        const { buffer, mimeType, extension } = await readUploadedFile(file, maxBytes, [...SUPPORTED_INVOICE_MIME_TYPES]);
        const hash = sha256(buffer);
        const duplicate = await prisma.invoice.findFirst({
          where: { companyId: company.id, fileSha256: hash, status: { not: "REJECTED" } },
          select: { id: true, status: true, fileName: true },
        });
        if (duplicate) {
          results.push({ id: duplicate.id, fileName: file.name, status: duplicate.status, duplicate: true });
          continue;
        }
        const key = buildStorageKey(company.id, "invoices", extension);
        await putObject(key, buffer);
        const invoice = await prisma.invoice.create({
          data: {
            companyId: company.id,
            fileKey: key,
            fileName: file.name.slice(0, 255) || `facture.${extension}`,
            mimeType,
            fileSize: buffer.length,
            fileSha256: hash,
            currency: company.currency,
            uploadedById: user.id,
          },
        });
        results.push({ id: invoice.id, fileName: invoice.fileName, status: invoice.status, duplicate: false });
      } catch (error) {
        results.push({
          id: "",
          fileName: file.name,
          status: "ERROR",
          duplicate: false,
          error: error instanceof AppError ? error.message : "Échec de l'enregistrement du fichier.",
        });
      }
    }
    return NextResponse.json({ results }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
