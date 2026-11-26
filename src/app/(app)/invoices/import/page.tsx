import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { isGeminiConfigured } from "@/lib/gemini-invoice-extractor";
import { PageHeader } from "@/components/page-header";
import { InvoiceImporter } from "@/components/invoices/invoice-importer";
import { ReextractButton } from "@/components/invoices/reextract-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES } from "@/lib/constants";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Import IA des factures" };

export default async function InvoiceImportPage() {
  const { company } = await requirePageContext("invoice:import");
  const aiConfigured = isGeminiConfigured();
  const pending = await prisma.invoice.findMany({
    where: { companyId: company.id, status: { in: ["UPLOADED", "EXTRACTING", "EXTRACTED", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { uploadedBy: { select: { name: true } } },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import IA des factures fournisseurs"
        description="Déposez vos factures : Gemini extrait l'en-tête (fournisseur, ICE, n°, date, totaux) et chaque ligne, distingue immobilisations et consommables et propose la catégorie comptable. Vous validez ensuite en vis-à-vis du document avant la génération des fiches."
      />
      {!aiConfigured && (
        <Alert variant="warning">
          <KeyRound />
          <AlertTitle>Extraction IA non configurée</AlertTitle>
          <AlertDescription>
            Renseignez <code className="rounded bg-muted px-1">GEMINI_API_KEY</code> dans l&apos;environnement du serveur. En attendant, les documents
            peuvent être déposés et saisis manuellement dans l&apos;écran de vérification.
          </AlertDescription>
        </Alert>
      )}
      <InvoiceImporter aiConfigured={aiConfigured} maxMb={Number(process.env.MAX_INVOICE_UPLOAD_MB ?? "25")} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents en attente de validation</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">Aucun document en attente.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="hidden md:table-cell">N° / date</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Total HT</TableHead>
                  <TableHead className="hidden lg:table-cell">Déposé</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="max-w-[260px]">
                      <span className="block truncate font-medium">{inv.fileName}</span>
                      {inv.extractionError && <span className="block truncate text-xs text-destructive">{inv.extractionError}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={INVOICE_STATUS_TONES[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{inv.number ?? "—"}</TableCell>
                    <TableCell className="hidden text-right tabular md:table-cell">
                      {inv.totalHT ? formatMoney(Number(inv.totalHT), inv.currency) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {formatDateTime(inv.createdAt)} · {inv.uploadedBy.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {aiConfigured && inv.status !== "EXTRACTING" && (
                          <ReextractButton invoiceId={inv.id} label={inv.status === "UPLOADED" ? "Extraire" : "Relancer"} />
                        )}
                        <Button size="sm" asChild>
                          <Link href={`/invoices/import/${inv.id}`}>Vérifier</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
