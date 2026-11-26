import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  FileClock,
  Landmark,
  PiggyBank,
  QrCode,
  ScanLine,
  Sparkles,
  Tag,
} from "lucide-react";
import { requirePageContext } from "@/lib/server/auth";
import { getDashboardData } from "@/lib/server/queries/dashboard";
import { PageHeader, StatTile } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CampaignProgressChart, CapexChart, CategoryChart } from "@/components/dashboard/charts";
import { ASSET_STATUS_LABELS, ASSET_STATUS_TONES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES, EVENT_TYPE_LABELS } from "@/lib/constants";
import { ASSET_STATUSES } from "@/lib/domain";
import { formatDateTime, formatMoney, formatMoneyCompact, formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const { company } = await requirePageContext("asset:read");
  const { forbidden } = await searchParams;
  const data = await getDashboardData(company);
  const { totals, reconciliation } = data;
  const currency = company.currency;
  const depreciationRate = totals.gross ? 1 - totals.nbv / totals.gross : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord exécutif & audit"
        description={`${company.name} — situation du parc immobilisé au ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}.`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/invoices/import">
                <Sparkles /> Importer des factures
              </Link>
            </Button>
            <Button asChild>
              <Link href="/campaigns">
                <ClipboardCheck /> Campagnes d&apos;inventaire
              </Link>
            </Button>
          </>
        }
      />

      {forbidden && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>Votre profil ne donne pas accès à la page demandée.</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" aria-label="Indicateurs clés">
        <StatTile
          label="Valeur brute"
          value={formatMoneyCompact(totals.gross, currency)}
          sub={`${formatNumber(totals.activeCount)} biens à l'actif`}
          icon={<Landmark />}
          tone="info"
        />
        <StatTile
          label="Valeur nette comptable"
          value={formatMoneyCompact(totals.nbv, currency)}
          sub={`Amorti à ${formatPercent(depreciationRate)}`}
          icon={<PiggyBank />}
          tone="info"
        />
        <StatTile
          label="Taux de rapprochement"
          value={reconciliation ? formatPercent(reconciliation.rate) : "—"}
          sub={reconciliation ? `${reconciliation.campaign.code} · ${formatNumber(reconciliation.found)}/${formatNumber(reconciliation.expected)} retrouvés` : "Aucune campagne lancée"}
          icon={<ScanLine />}
          tone={reconciliation && reconciliation.rate >= 0.95 ? "success" : "warning"}
        />
        <StatTile
          label="Valeur des manquants"
          value={formatMoneyCompact(totals.missingValue, currency)}
          sub={`${formatNumber(totals.missingCount)} bien(s) non retrouvé(s) — VNC`}
          icon={<AlertTriangle />}
          tone={totals.missingCount ? "destructive" : "success"}
        />
        <StatTile
          label="Biens non étiquetés"
          value={formatNumber(totals.untagged)}
          sub={<Link href="/assets/labels" className="text-primary hover:underline">Générer les étiquettes →</Link>}
          icon={<Tag />}
          tone={totals.untagged ? "warning" : "success"}
        />
        <StatTile
          label="Factures en attente"
          value={formatNumber(totals.pendingInvoices)}
          sub={<Link href="/invoices" className="text-primary hover:underline">Extraction / validation →</Link>}
          icon={<FileClock />}
          tone={totals.pendingInvoices ? "warning" : "success"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Répartition par catégorie comptable</CardTitle>
            <CardDescription>Valeur brute et valeur nette comptable des biens à l&apos;actif ({currency}).</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryChart data={data.categories} currency={currency} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Acquisitions mensuelles (CapEx)</CardTitle>
            <CardDescription>Montant HT des immobilisations acquises sur 12 mois glissants.</CardDescription>
          </CardHeader>
          <CardContent>
            <CapexChart data={data.capex} currency={currency} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle>Avancement de la campagne d&apos;inventaire</CardTitle>
              <CardDescription>
                {reconciliation ? `${reconciliation.campaign.code} — ${reconciliation.campaign.name}` : "Biens retrouvés vs restant à scanner."}
              </CardDescription>
            </div>
            {reconciliation && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/campaigns/${reconciliation.campaign.id}`}>
                  Détail <ArrowRight />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <CampaignProgressChart bySite={data.progressBySite} byFloor={data.progressByFloor} />
          </CardContent>
        </Card>
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Cycle de vie du parc</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ASSET_STATUSES.map((s) => {
                const total = Object.values(data.statusCounts).reduce((a, b) => a + b, 0) || 1;
                return (
                  <div key={s} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <Badge variant={ASSET_STATUS_TONES[s]}>{ASSET_STATUS_LABELS[s]}</Badge>
                      <span className="tabular text-muted-foreground">{formatNumber(data.statusCounts[s])}</span>
                    </div>
                    <Progress value={(data.statusCounts[s] / total) * 100} className="h-1.5" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Campagnes actives</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.activeCampaigns.length === 0 && <p className="text-sm text-muted-foreground">Aucune campagne en cours.</p>}
              {data.activeCampaigns.map((c) => (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.code} · {formatNumber(c._count.snapshotItems)} biens théoriques
                    </p>
                  </div>
                  <Badge variant={CAMPAIGN_STATUS_TONES[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Derniers mouvements</CardTitle>
            <CardDescription>Extrait du journal d&apos;audit immuable.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/audit">
              Journal complet <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.recentEvents.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="w-36 shrink-0 text-xs text-muted-foreground tabular">{formatDateTime(e.createdAt)}</span>
                <Badge variant="muted" className="w-fit">{EVENT_TYPE_LABELS[e.type]}</Badge>
                <Link href={`/assets/${e.asset.id}`} className="font-mono text-xs text-primary hover:underline">
                  {e.asset.code}
                </Link>
                <span className="min-w-0 flex-1 truncate text-sm">{e.summary}</span>
                <span className="text-xs text-muted-foreground">{e.user?.name ?? "Système"}</span>
              </li>
            ))}
            {data.recentEvents.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Aucun mouvement enregistré.</li>}
          </ul>
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <QrCode className="h-3.5 w-3.5" /> Montants en {currency} — VNC calculée à date selon le plan d&apos;amortissement de chaque bien ({formatMoney(totals.gross - totals.nbv, currency)} d&apos;amortissements cumulés).
      </p>
    </div>
  );
}
