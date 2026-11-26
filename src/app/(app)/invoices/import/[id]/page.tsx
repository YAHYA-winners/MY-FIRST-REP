import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { isGeminiConfigured } from "@/lib/gemini-invoice-extractor";
import { DOCUMENT_TYPE_LABELS, type DocumentType, type ExtractedInvoice } from "@/lib/invoice-normalization";
import { PageHeader } from "@/components/page-header";
import { InvoiceReview } from "@/components/invoices/invoice-review";
import { emptyLine, type ReviewDraft } from "@/lib/invoice-draft";
import { ReextractButton } from "@/components/invoices/reextract-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES } from "@/lib/constants";
import { formatDateTime, formatMoney, toDateInput } from "@/lib/format";
import { uniqueId } from "@/lib/utils";

export const metadata: Metadata = { title: "Vérification de facture" };

export default async function InvoiceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, company } = await requirePageContext("invoice:read");
  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId: company.id },
    include: {
      supplier: true,
      lines: { orderBy: { lineNo: "asc" } },
      assets: { orderBy: { code: "asc" }, select: { id: true, code: true, designation: true, serialNumber: true, acquisitionValue: true } },
      validatedBy: { select: { name: true } },
    },
  });
  if (!invoice) notFound();

  const [categories, locations, costCenters, departments] = await Promise.all([
    prisma.assetCategory.findMany({ where: { companyId: company.id, active: true }, orderBy: { assetAccount: "asc" }, select: { id: true, code: true, name: true, assetAccount: true } }),
    prisma.location.findMany({ where: { companyId: company.id, active: true }, orderBy: { path: "asc" }, select: { id: true, path: true } }),
    prisma.costCenter.findMany({ where: { companyId: company.id, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.department.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const categoryByCode = new Map(categories.map((c) => [c.code.toUpperCase(), c.id]));
  const extraction = (invoice.extractedData as { data?: ExtractedInvoice } | null)?.data ?? null;

  let initial: ReviewDraft;
  if (invoice.lines.length) {
    initial = {
      supplier: {
        name: invoice.supplier?.name ?? "",
        ice: invoice.supplier?.ice ?? "",
        taxId: invoice.supplier?.taxId ?? "",
        tradeRegister: invoice.supplier?.tradeRegister ?? "",
        address: invoice.supplier?.address ?? "",
      },
      number: invoice.number ?? "",
      invoiceDate: toDateInput(invoice.invoiceDate),
      currency: invoice.currency,
      totalHT: invoice.totalHT?.toString() ?? "",
      totalVAT: invoice.totalVAT?.toString() ?? "",
      totalTTC: invoice.totalTTC?.toString() ?? "",
      lines: invoice.lines.map((l) => ({
        key: l.id,
        designation: l.designation,
        specifications: l.specifications ?? "",
        brand: l.brand ?? "",
        model: l.model ?? "",
        serials: l.serialNumbers.join("\n"),
        quantity: l.quantity.toString(),
        unitPriceHT: l.unitPriceHT.toString(),
        vatRate: String(Number(l.vatRate)),
        isFixedAsset: l.isFixedAsset,
        splitIntoUnits: l.splitIntoUnits,
        categoryId: l.categoryId ?? "",
        aiCategoryCode: l.aiCategoryCode,
        aiConfidence: l.aiConfidence,
        rationale: null,
        warnings: [],
        belowThreshold: false,
      })),
    };
  } else if (extraction) {
    initial = {
      supplier: {
        name: extraction.supplier.name ?? "",
        ice: extraction.supplier.ice ?? "",
        taxId: extraction.supplier.taxId ?? "",
        tradeRegister: extraction.supplier.tradeRegister ?? "",
        address: extraction.supplier.address ?? "",
      },
      number: extraction.invoice.number ?? "",
      invoiceDate: extraction.invoice.date ?? "",
      currency: extraction.invoice.currency || company.currency,
      totalHT: extraction.invoice.totalHT?.toString() ?? "",
      totalVAT: extraction.invoice.totalVAT?.toString() ?? "",
      totalTTC: extraction.invoice.totalTTC?.toString() ?? "",
      lines: extraction.lines.map((l) => ({
        key: uniqueId(),
        designation: l.designation,
        specifications: l.specifications ?? "",
        brand: l.brand ?? "",
        model: l.model ?? "",
        serials: l.serialNumbers.join("\n"),
        quantity: String(l.quantity),
        unitPriceHT: String(l.unitPriceHT),
        vatRate: String(l.vatRate),
        isFixedAsset: l.isFixedAsset,
        splitIntoUnits: true,
        categoryId: l.categoryCode ? categoryByCode.get(l.categoryCode) ?? "" : "",
        aiCategoryCode: l.categoryCode,
        aiConfidence: l.confidence,
        rationale: l.classificationRationale,
        warnings: l.warnings,
        belowThreshold: l.belowThreshold,
      })),
    };
  } else {
    initial = {
      supplier: { name: "", ice: "", taxId: "", tradeRegister: "", address: "" },
      number: invoice.number ?? "",
      invoiceDate: toDateInput(invoice.invoiceDate),
      currency: invoice.currency,
      totalHT: invoice.totalHT?.toString() ?? "",
      totalVAT: invoice.totalVAT?.toString() ?? "",
      totalTTC: invoice.totalTTC?.toString() ?? "",
      lines: [emptyLine()],
    };
  }

  const editable = !["VALIDATED", "REJECTED"].includes(invoice.status);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/invoices/import">
          <ArrowLeft /> Import IA
        </Link>
      </Button>
      <PageHeader
        eyebrow="Vérification en vis-à-vis"
        title={invoice.supplier?.name ?? invoice.fileName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={INVOICE_STATUS_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
            {invoice.validatedAt && (
              <span>
                Validée le {formatDateTime(invoice.validatedAt)} par {invoice.validatedBy?.name}
              </span>
            )}
            {invoice.rejectionReason && <span>Motif du rejet : {invoice.rejectionReason}</span>}
          </span>
        }
        actions={
          editable && isGeminiConfigured() && can(user.role, "invoice:import") && invoice.status !== "EXTRACTING" ? (
            <ReextractButton invoiceId={invoice.id} label={extraction ? "Relancer l'extraction IA" : "Lancer l'extraction IA"} />
          ) : undefined
        }
      />
      <InvoiceReview
        key={`${invoice.id}-${invoice.updatedAt.getTime()}`}
        invoice={{
          id: invoice.id,
          status: invoice.status,
          fileName: invoice.fileName,
          mimeType: invoice.mimeType,
          fileUrl: `/api/files/${invoice.fileKey}`,
          model: invoice.extractionModel,
          durationMs: invoice.extractionDurationMs,
          confidence: invoice.confidence,
          error: invoice.extractionError,
          documentTypeLabel: invoice.documentType ? DOCUMENT_TYPE_LABELS[invoice.documentType as DocumentType] ?? invoice.documentType : null,
          warnings: editable ? invoice.extractionWarnings : [],
        }}
        initial={initial}
        categories={categories}
        locations={locations.map((l) => ({ id: l.id, label: l.path }))}
        costCenters={costCenters.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
        departments={departments.map((d) => ({ id: d.id, label: d.name }))}
        threshold={Number(company.capitalizationThreshold)}
        canValidate={can(user.role, "invoice:validate")}
      />
      {invoice.assets.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Fiches immobilisations générées ({invoice.assets.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Désignation</TableHead>
                  <TableHead>N° de série</TableHead>
                  <TableHead className="text-right">Valeur HT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/assets/${a.id}`} className="font-mono text-xs text-primary hover:underline">
                        {a.code}
                      </Link>
                    </TableCell>
                    <TableCell>{a.designation}</TableCell>
                    <TableCell className="font-mono text-xs">{a.serialNumber ?? "—"}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(Number(a.acquisitionValue), invoice.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
