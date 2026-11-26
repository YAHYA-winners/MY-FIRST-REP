import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Factures" };

export default async function InvoicesPage() {
  const { company } = await requirePageContext("invoice:read");
  const invoices = await prisma.invoice.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { supplier: { select: { name: true } }, _count: { select: { assets: true } } },
  });
  return (
    <div>
      <PageHeader
        title="Factures fournisseurs"
        description="Pièces justificatives des acquisitions : chaque immobilisation générée reste rattachée à sa facture et à sa ligne d'origine."
        actions={
          <Button asChild>
            <Link href="/invoices/import">
              <Sparkles /> Importer avec l&apos;IA
            </Link>
          </Button>
        }
      />
      {invoices.length === 0 ? (
        <EmptyState icon={<FileText className="h-10 w-10" />} title="Aucune facture" description="Déposez vos premières factures pour générer automatiquement les fiches immobilisations." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fournisseur</TableHead>
                <TableHead>N° facture</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Total HT</TableHead>
                <TableHead className="hidden text-right md:table-cell">Total TTC</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Fiches</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="max-w-[240px]">
                    <Link href={`/invoices/import/${inv.id}`} className="block truncate font-medium hover:underline">
                      {inv.supplier?.name ?? inv.fileName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{inv.number ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(inv.invoiceDate)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_TONES[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular">{inv.totalHT ? formatMoney(Number(inv.totalHT), inv.currency) : "—"}</TableCell>
                  <TableCell className="hidden text-right tabular md:table-cell">{inv.totalTTC ? formatMoney(Number(inv.totalTTC), inv.currency) : "—"}</TableCell>
                  <TableCell className="hidden text-right tabular lg:table-cell">{inv._count.assets}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
