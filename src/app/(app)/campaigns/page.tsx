import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Plus, ScanLine } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from "@/lib/constants";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Campagnes d'inventaire" };

export default async function CampaignsPage() {
  const { user, company } = await requirePageContext("campaign:read");
  const campaigns = await prisma.inventoryCampaign.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: {
      scopeLocations: { include: { location: { select: { name: true } } } },
      _count: { select: { snapshotItems: true, surpluses: true } },
    },
  });
  const scannedCounts = await prisma.campaignScan.groupBy({
    by: ["campaignId", "assetId"],
    where: { campaignId: { in: campaigns.map((c) => c.id) }, snapshotItemId: { not: null } },
  });
  const found = new Map<string, number>();
  for (const row of scannedCounts) found.set(row.campaignId, (found.get(row.campaignId) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        title="Campagnes d'inventaire physique"
        description="Préparez le périmètre, figez le fichier comptable théorique, comptez sur le terrain puis rapprochez et éditez le PV."
        actions={
          can(user.role, "campaign:manage") && (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus /> Nouvelle campagne
              </Link>
            </Button>
          )
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-10 w-10" />} title="Aucune campagne" description="Créez votre première campagne d'inventaire en définissant son périmètre." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {campaigns.map((c) => {
            const expected = c._count.snapshotItems;
            const done = found.get(c.id) ?? 0;
            const rate = expected ? done / expected : 0;
            return (
              <Card key={c.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                      <Link href={`/campaigns/${c.id}`} className="block truncate font-semibold hover:underline">
                        {c.name}
                      </Link>
                    </div>
                    <Badge variant={CAMPAIGN_STATUS_TONES[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    Périmètre : {c.scopeLocations.length ? c.scopeLocations.map((s) => s.location.name).join(", ") : "toute la société"}
                  </p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        {formatNumber(done)} / {formatNumber(expected)} retrouvés · {formatNumber(c._count.surpluses)} excédent(s)
                      </span>
                      <span className="font-medium tabular">{expected ? formatPercent(rate) : "—"}</span>
                    </div>
                    <Progress value={rate * 100} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.launchedAt ? `Lancée le ${formatDate(c.launchedAt)}` : c.plannedStartDate ? `Prévue le ${formatDate(c.plannedStartDate)}` : "Non planifiée"}
                    {c.pvNumber && ` · ${c.pvNumber}`}
                  </p>
                  <div className="mt-auto flex gap-2 pt-2">
                    <Button size="sm" variant="outline" asChild className="flex-1">
                      <Link href={`/campaigns/${c.id}`}>Piloter</Link>
                    </Button>
                    {c.status === "IN_PROGRESS" && can(user.role, "campaign:scan") && (
                      <Button size="sm" asChild className="flex-1">
                        <Link href={`/campaigns/${c.id}/scan`}>
                          <ScanLine /> Mode terrain
                        </Link>
                      </Button>
                    )}
                    {(c.status === "COUNT_CLOSED" || c.status === "VALIDATED" || c.status === "IN_PROGRESS") && (
                      <Button size="sm" variant="secondary" asChild className="flex-1">
                        <Link href={`/campaigns/${c.id}/reconcile`}>Rapprochement</Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
