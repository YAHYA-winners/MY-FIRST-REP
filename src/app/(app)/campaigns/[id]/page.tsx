import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Boxes, CheckCircle2, CircleDashed, PackageSearch, ScanLine, Smartphone } from "lucide-react";
import { QrCode } from "@/components/qr-code";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { computeCampaignProgress } from "@/lib/server/queries/campaigns";
import { PageHeader, StatTile } from "@/components/page-header";
import { CampaignControls } from "@/components/campaigns/campaign-controls";
import { CampaignProgressChart } from "@/components/dashboard/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET_CONDITION_LABELS, ASSET_CONDITION_TONES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from "@/lib/constants";
import type { CampaignStatusValue } from "@/lib/domain";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Campagne d'inventaire" };

const STEPS: { status: CampaignStatusValue; label: string }[] = [
  { status: "DRAFT", label: "Préparation" },
  { status: "IN_PROGRESS", label: "Comptage terrain" },
  { status: "COUNT_CLOSED", label: "Rapprochement & régularisations" },
  { status: "VALIDATED", label: "PV validé" },
];

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, company } = await requirePageContext("campaign:read");
  const { id } = await params;
  const campaign = await prisma.inventoryCampaign.findFirst({
    where: { id, companyId: company.id },
    include: {
      createdBy: { select: { name: true } },
      validatedBy: { select: { name: true } },
      members: { include: { user: { select: { name: true } } } },
      scopeLocations: { include: { location: { select: { path: true } } } },
      scopeCategories: { include: { category: { select: { name: true } } } },
      _count: { select: { scans: true, surpluses: true, results: true } },
    },
  });
  if (!campaign) notFound();
  const [progress, recentScans, mismatches] = await Promise.all([
    computeCampaignProgress(company.id, campaign.id),
    prisma.campaignScan.findMany({
      where: { campaignId: campaign.id },
      orderBy: { scannedAt: "desc" },
      take: 15,
      include: {
        asset: { select: { id: true, code: true, designation: true } },
        location: { select: { name: true } },
        scannedBy: { select: { name: true } },
      },
    }),
    prisma.campaignScan.count({ where: { campaignId: campaign.id, isLocationMismatch: true } }),
  ]);
  const stepIndex = STEPS.findIndex((s) => s.status === campaign.status);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const scanUrl = `${appUrl}/campaigns/${campaign.id}/scan`;
  const rate = progress.expected ? progress.found / progress.expected : 0;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/campaigns">
          <ArrowLeft /> Campagnes
        </Link>
      </Button>
      <PageHeader
        className="mb-0"
        eyebrow={<span className="font-mono">{campaign.code}</span>}
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={CAMPAIGN_STATUS_TONES[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
            <span>
              Créée par {campaign.createdBy.name}
              {campaign.launchedAt && ` · lancée le ${formatDateTime(campaign.launchedAt)}`}
              {campaign.pvNumber && ` · ${campaign.pvNumber}`}
            </span>
          </span>
        }
        actions={
          <>
            <CampaignControls campaignId={campaign.id} status={campaign.status} canManage={can(user.role, "campaign:manage")} />
            {campaign.status === "IN_PROGRESS" && can(user.role, "campaign:scan") && (
              <Button asChild>
                <Link href={`/campaigns/${campaign.id}/scan`}>
                  <ScanLine /> Mode terrain
                </Link>
              </Button>
            )}
            {campaign.status !== "DRAFT" && (
              <Button variant="secondary" asChild>
                <Link href={`/campaigns/${campaign.id}/reconcile`}>
                  Rapprochement & exports <ArrowRight />
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ol className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((step, i) => (
          <li
            key={step.status}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              i < stepIndex && "border-success/30 bg-success/5 text-success",
              i === stepIndex && "border-primary bg-accent font-medium text-primary",
              i > stepIndex && "text-muted-foreground",
            )}
          >
            {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
            {i + 1}. {step.label}
          </li>
        ))}
      </ol>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Biens théoriques" value={formatNumber(progress.expected)} sub={campaign.status === "DRAFT" ? "Figés au lancement" : "Fichier comptable figé"} icon={<Boxes />} tone="info" />
        <StatTile label="Retrouvés" value={formatNumber(progress.found)} sub={`Taux de rapprochement ${formatPercent(rate)}`} icon={<CheckCircle2 />} tone={rate >= 0.95 ? "success" : "warning"} />
        <StatTile label="Écarts de localisation" value={formatNumber(mismatches)} sub="Scans hors local attendu" icon={<ArrowRight />} tone={mismatches ? "warning" : "success"} />
        <StatTile label="Excédents saisis" value={formatNumber(campaign._count.surpluses)} sub="Biens non étiquetés / inconnus" icon={<PackageSearch />} tone={campaign._count.surpluses ? "warning" : "success"} />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Avancement par site / étage</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignProgressChart bySite={progress.bySite} byFloor={progress.byFloor} />
          </CardContent>
        </Card>
        <div className="space-y-6">
          {campaign.status === "IN_PROGRESS" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Smartphone className="h-4 w-4" /> Ouvrir sur smartphone
                </CardTitle>
                <CardDescription>Les inventoristes scannent ce QR pour lancer le mode terrain.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-2">
                <div className="rounded-lg border bg-white p-3">
                  <QrCode value={scanUrl} size={156} title="Lien du mode terrain" />
                </div>
                <p className="break-all text-center text-xs text-muted-foreground">{scanUrl}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Périmètre & équipe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Localisations</p>
                {campaign.scopeLocations.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {campaign.scopeLocations.map((s) => (
                      <li key={s.locationId}>{s.location.path}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Toute la société</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Catégories</p>
                <p>{campaign.scopeCategories.length ? campaign.scopeCategories.map((s) => s.category.name).join(", ") : "Toutes (suivies physiquement)"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Équipe</p>
                <p>
                  {campaign.members.length
                    ? campaign.members.map((m) => `${m.user.name}${m.role === "LEAD" ? " (responsable)" : ""}`).join(", ")
                    : "Non renseignée"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Planning</p>
                <p>
                  {formatDate(campaign.plannedStartDate)} → {formatDate(campaign.plannedEndDate)}
                </p>
              </div>
              {campaign.description && <p className="whitespace-pre-line rounded-md bg-muted/60 p-2 text-xs">{campaign.description}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Derniers scans ({formatNumber(campaign._count.scans)} au total)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun scan pour le moment.</p>
          ) : (
            <ul className="divide-y">
              {recentScans.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground tabular">{formatDateTime(s.scannedAt)}</span>
                  <Link href={`/assets/${s.asset.id}`} className="font-mono text-xs text-primary hover:underline">
                    {s.asset.code}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{s.asset.designation}</span>
                  <span className="text-xs text-muted-foreground">{s.location.name}</span>
                  {s.isLocationMismatch && <Badge variant="warning">Déplacé</Badge>}
                  <Badge variant={ASSET_CONDITION_TONES[s.condition]}>{ASSET_CONDITION_LABELS[s.condition]}</Badge>
                  <span className="text-xs text-muted-foreground">{s.scannedBy.name}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
