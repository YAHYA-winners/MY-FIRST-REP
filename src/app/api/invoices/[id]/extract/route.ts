import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActionContext } from "@/lib/server/auth";
import { handleApiError, jsonError } from "@/lib/server/api";
import { getObject } from "@/lib/server/storage";
import { InvoiceExtractionError, extractInvoice } from "@/lib/gemini-invoice-extractor";

export const runtime = "nodejs";
export const maxDuration = 300;

const STALE_EXTRACTION_MS = 5 * 60 * 1000;

/** Runs (or re-runs) the Gemini extraction of an uploaded invoice. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { company } = await requireActionContext("invoice:import");
    const { id } = await params;
    const invoice = await prisma.invoice.findFirst({ where: { id, companyId: company.id } });
    if (!invoice) return jsonError("Facture introuvable.", 404);
    if (invoice.status === "VALIDATED") return jsonError("Facture déjà validée.", 409);
    if (
      invoice.status === "EXTRACTING" &&
      invoice.extractionStartedAt &&
      Date.now() - invoice.extractionStartedAt.getTime() < STALE_EXTRACTION_MS
    ) {
      return jsonError("Extraction déjà en cours pour ce document.", 409);
    }

    // Optimistic lock: only one extraction at a time per invoice.
    const started = new Date();
    const lock = await prisma.invoice.updateMany({
      where: { id: invoice.id, updatedAt: invoice.updatedAt },
      data: { status: "EXTRACTING", extractionStartedAt: started, extractionError: null },
    });
    if (lock.count === 0) return jsonError("Le document a été modifié entre-temps, réessayez.", 409);

    try {
      const [data, categories] = await Promise.all([
        getObject(invoice.fileKey),
        prisma.assetCategory.findMany({
          where: { companyId: company.id, active: true },
          select: { code: true, name: true, description: true, assetAccount: true },
          orderBy: { assetAccount: "asc" },
        }),
      ]);
      const result = await extractInvoice({
        data,
        mimeType: invoice.mimeType,
        fileName: invoice.fileName,
        categories,
        companyName: company.legalName ?? company.name,
        capitalizationThreshold: Number(company.capitalizationThreshold),
        defaultCurrency: company.currency,
        signal: req.signal,
      });
      const { data: extracted } = result;
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "EXTRACTED",
          extractedData: {
            data: extracted,
            consistency: result.consistency,
            usage: result.usage,
            ingestion: result.ingestion,
            attempts: result.attempts,
          } as unknown as Prisma.InputJsonValue,
          extractionModel: result.model,
          extractionCompletedAt: new Date(),
          extractionDurationMs: result.durationMs,
          extractionWarnings: extracted.warnings,
          confidence: extracted.overallConfidence,
          documentType: extracted.documentType,
          number: extracted.invoice.number,
          invoiceDate: extracted.invoice.date ? new Date(`${extracted.invoice.date}T00:00:00Z`) : null,
          dueDate: extracted.invoice.dueDate ? new Date(`${extracted.invoice.dueDate}T00:00:00Z`) : null,
          currency: extracted.invoice.currency,
          totalHT: extracted.invoice.totalHT,
          totalVAT: extracted.invoice.totalVAT,
          totalTTC: extracted.invoice.totalTTC,
        },
      });
      return NextResponse.json({
        id: updated.id,
        status: updated.status,
        lines: extracted.lines.length,
        assets: extracted.lines.filter((l) => l.isFixedAsset).length,
        confidence: extracted.overallConfidence,
        durationMs: result.durationMs,
      });
    } catch (error) {
      const message =
        error instanceof InvoiceExtractionError ? error.message : "Erreur inattendue pendant l'extraction.";
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "FAILED",
          extractionError: message,
          extractionCompletedAt: new Date(),
          extractionDurationMs: Date.now() - started.getTime(),
        },
      });
      if (error instanceof InvoiceExtractionError) {
        return jsonError(message, error.httpStatus, { code: error.code });
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
