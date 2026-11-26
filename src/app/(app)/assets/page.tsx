import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Package, Plus, QrCode, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { listAssets, type AssetFilters } from "@/lib/server/queries/assets";
import { can } from "@/lib/permissions";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RegisterExportButton } from "@/components/assets/register-export-button";
import { ASSET_STATUS_LABELS, ASSET_STATUS_TONES, TAG_STATUS_LABELS, TAG_STATUS_TONES } from "@/lib/constants";
import { ASSET_STATUSES, TAG_STATUSES } from "@/lib/domain";
import { formatMoney, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Immobilisations" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<AssetFilters> }) {
  const { user, company } = await requirePageContext("asset:read");
  const filters = await searchParams;
  const [data, categories, locations] = await Promise.all([
    listAssets(company, filters),
    prisma.assetCategory.findMany({ where: { companyId: company.id }, orderBy: { assetAccount: "asc" }, select: { id: true, name: true, assetAccount: true } }),
    prisma.location.findMany({ where: { companyId: company.id, depth: { lte: 2 } }, orderBy: { path: "asc" }, select: { id: true, path: true } }),
  ]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    params.set("page", String(page));
    return `/assets?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Fichier des immobilisations"
        description="Registre comptable et physique : valeur d'origine, amortissements, VNC, localisation, affectation et étiquetage."
        actions={
          <>
            <RegisterExportButton />
            {can(user.role, "asset:import") && (
              <Button variant="outline" asChild>
                <Link href="/assets/import">
                  <FileSpreadsheet /> Importer
                </Link>
              </Button>
            )}
            {can(user.role, "label:print") && (
              <Button variant="outline" asChild>
                <Link href="/assets/labels">
                  <QrCode /> Étiquettes
                </Link>
              </Button>
            )}
            {can(user.role, "asset:write") && (
              <Button asChild>
                <Link href="/assets/new">
                  <Plus /> Nouvelle immobilisation
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4 p-3">
        <form className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" method="GET">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={filters.q} placeholder="Code, désignation, n° de série, marque, collaborateur…" className="pl-8" />
          </div>
          <NativeSelect name="status" defaultValue={filters.status ?? ""} aria-label="Statut">
            <option value="">Actifs (hors sorties)</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ASSET_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="category" defaultValue={filters.category ?? ""} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.assetAccount} — {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="location" defaultValue={filters.location ?? ""} aria-label="Localisation">
            <option value="">Toutes localisations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="tag" defaultValue={filters.tag ?? ""} aria-label="Étiquetage">
            <option value="">Tout étiquetage</option>
            {TAG_STATUSES.map((t) => (
              <option key={t} value={t}>
                {TAG_STATUS_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
        </form>
      </Card>

      {data.total === 0 ? (
        <EmptyState
          icon={<Package className="h-10 w-10" />}
          title="Aucune immobilisation"
          description="Aucun bien ne correspond aux filtres. Importez vos factures avec l'IA ou le fichier comptable existant pour alimenter le registre."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Désignation</TableHead>
                <TableHead className="hidden lg:table-cell">Catégorie</TableHead>
                <TableHead className="hidden md:table-cell">Localisation</TableHead>
                <TableHead className="hidden xl:table-cell">Collaborateur</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden sm:table-cell">Étiquette</TableHead>
                <TableHead className="text-right">Valeur brute</TableHead>
                <TableHead className="text-right">VNC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/assets/${a.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                      {a.code}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <Link href={`/assets/${a.id}`} className="block truncate font-medium hover:underline">
                      {a.designation}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[a.brand, a.model, a.serialNumber && `S/N ${a.serialNumber}`].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{a.category}</TableCell>
                  <TableCell className="hidden max-w-[260px] md:table-cell">
                    <span className="block truncate text-xs text-muted-foreground" title={a.location ?? ""}>
                      {a.location ?? "Non localisé"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm xl:table-cell">{a.custodian ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Badge variant={ASSET_STATUS_TONES[a.status]}>{ASSET_STATUS_LABELS[a.status]}</Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={TAG_STATUS_TONES[a.tagStatus]}>{TAG_STATUS_LABELS[a.tagStatus]}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(a.gross, company.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular">{formatMoney(a.nbv, company.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>{formatNumber(data.total)} bien(s) — totaux de la sélection</TableCell>
                <TableCell className="hidden lg:table-cell" />
                <TableCell className="hidden md:table-cell" />
                <TableCell className="hidden xl:table-cell" />
                <TableCell />
                <TableCell className="hidden sm:table-cell" />
                <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(data.totals.gross, company.currency)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(data.totals.nbv, company.currency)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Page {data.page} / {data.pageCount}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild disabled={data.page <= 1}>
                <Link href={pageHref(Math.max(1, data.page - 1))} aria-disabled={data.page <= 1} className={data.page <= 1 ? "pointer-events-none opacity-50" : ""}>
                  <ChevronLeft /> Précédent
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={pageHref(Math.min(data.pageCount, data.page + 1))}
                  aria-disabled={data.page >= data.pageCount}
                  className={data.page >= data.pageCount ? "pointer-events-none opacity-50" : ""}
                >
                  Suivant <ChevronRight />
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
