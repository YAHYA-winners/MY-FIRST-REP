import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, History, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { requirePageContext } from "@/lib/server/auth";
import { getAssetDetail, getAssetFormOptions } from "@/lib/server/queries/assets";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AssetActions } from "@/components/assets/asset-actions";
import { AssetQrCard } from "@/components/assets/asset-qr-card";
import { AssignmentHistory, type AssignmentView } from "@/components/assets/assignment-history";
import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_TONES,
  ASSET_ORIGIN_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_TONES,
  DEPRECIATION_METHOD_LABELS,
  DISPOSAL_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  TAG_STATUS_LABELS,
  TAG_STATUS_TONES,
} from "@/lib/constants";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Fiche immobilisation" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children ?? "—"}</dd>
    </div>
  );
}

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, company } = await requirePageContext("asset:read");
  const { id } = await params;
  const detail = await getAssetDetail(company, id);
  if (!detail) notFound();
  const { asset, schedule, state } = detail;
  const options = await getAssetFormOptions(company.id);
  const currency = asset.currency || company.currency;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const disposalEvent = asset.events.find((e) => e.type === "DISPOSED");
  const currentYear = new Date().getUTCFullYear();

  const assignments: AssignmentView[] = asset.assignments.map((a) => ({
    id: a.id,
    employeeName: `${a.employee.firstName} ${a.employee.lastName}`,
    matricule: a.employee.matricule,
    assignedAt: a.assignedAt.toISOString(),
    returnedAt: a.returnedAt?.toISOString() ?? null,
    signatureKey: a.signatureKey,
    pdf: {
      company: {
        name: company.name,
        legalName: company.legalName,
        ice: company.ice,
        address: company.address,
        city: company.city,
        currency: company.currency,
      },
      asset: {
        code: asset.code,
        designation: asset.designation,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
        category: asset.category.name,
        value: Number(asset.acquisitionValue),
        location: asset.location?.path ?? null,
      },
      employee: {
        name: `${a.employee.firstName} ${a.employee.lastName}`,
        matricule: a.employee.matricule,
        jobTitle: a.employee.jobTitle,
        department: asset.department?.name ?? null,
      },
      assignment: {
        assignedAt: a.assignedAt.toISOString(),
        condition: ASSET_CONDITION_LABELS[a.conditionAtHandover],
        signerName: a.signerName,
        signedAt: a.signedAt?.toISOString() ?? null,
        signerIp: a.signerIp,
        notes: a.notes,
        assignedBy: a.assignedBy?.name ?? null,
        returnedAt: a.returnedAt?.toISOString() ?? null,
      },
    },
  }));

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/assets">
          <ArrowLeft /> Registre
        </Link>
      </Button>
      <PageHeader
        eyebrow={<span className="font-mono">{asset.code}</span>}
        title={asset.designation}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ASSET_STATUS_TONES[asset.status]}>{ASSET_STATUS_LABELS[asset.status]}</Badge>
            <Badge variant={ASSET_CONDITION_TONES[asset.condition]}>{ASSET_CONDITION_LABELS[asset.condition]}</Badge>
            <Badge variant={TAG_STATUS_TONES[asset.tagStatus]}>{TAG_STATUS_LABELS[asset.tagStatus]}</Badge>
            <span className="text-muted-foreground">
              {asset.category.assetAccount} — {asset.category.name}
            </span>
          </span>
        }
        actions={
          <AssetActions
            asset={{
              id: asset.id,
              code: asset.code,
              status: asset.status,
              condition: asset.condition,
              custodianName: asset.custodian ? `${asset.custodian.firstName} ${asset.custodian.lastName}` : null,
              locationId: asset.locationId,
              netBookValue: state.netBookValue,
            }}
            currency={currency}
            locations={options.locations.map((l) => ({ id: l.id, label: l.path }))}
            employees={options.employees.map((e) => ({ id: e.id, label: `${e.firstName} ${e.lastName} (${e.matricule})` }))}
            departments={options.departments.map((d) => ({ id: d.id, label: d.name }))}
            costCenters={options.costCenters.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
            permissions={{
              write: can(user.role, "asset:write"),
              transfer: can(user.role, "asset:transfer"),
              assign: can(user.role, "asset:assign"),
              dispose: can(user.role, "asset:dispose"),
            }}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Identification</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Row label="Marque / modèle">{[asset.brand, asset.model].filter(Boolean).join(" ") || "—"}</Row>
                  <Row label="N° de série">{asset.serialNumber ? <span className="font-mono">{asset.serialNumber}</span> : "—"}</Row>
                  <Row label="Quantité">{formatNumber(asset.quantity)}</Row>
                  <Row label="Fournisseur">{asset.supplier?.name}</Row>
                  <Row label="Pièce justificative">
                    {asset.invoice ? (
                      <Link href={`/invoices/import/${asset.invoice.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <FileText className="h-3.5 w-3.5" /> {asset.invoice.number ?? asset.invoice.fileName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Row>
                  <Row label="Origine">
                    {ASSET_ORIGIN_LABELS[asset.origin]}
                    {asset.integratedFrom && ` (${asset.integratedFrom.tempTag} · ${asset.integratedFrom.campaign.code})`}
                  </Row>
                  <Row label="Fin de garantie">{formatDate(asset.warrantyEndDate)}</Row>
                  <Row label="Dernier constat physique">{formatDateTime(asset.lastSeenAt)}</Row>
                  <Row label="Créée par">{asset.createdBy?.name ?? "—"}</Row>
                </dl>
                {asset.description && <p className="mt-3 whitespace-pre-line rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">{asset.description}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Données financières</CardTitle>
                <CardDescription>Calculées au {formatDate(new Date())}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <Row label="Date d'acquisition">{formatDate(asset.acquisitionDate)}</Row>
                  <Row label="Mise en service">{formatDate(asset.commissioningDate)}</Row>
                  <Row label="Valeur d'origine HT">{formatMoney(Number(asset.acquisitionValue), currency)}</Row>
                  <Row label="Méthode">
                    {DEPRECIATION_METHOD_LABELS[asset.depreciationMethod]}
                    {asset.depreciationMethod !== "NONE" && ` · ${asset.usefulLifeYears} ans · ${state.annualRate.toFixed(2)} %`}
                  </Row>
                  <Row label={`Dotation ${currentYear}`}>{formatMoney(state.currentYearAnnuity, currency)}</Row>
                  <Row label="Amortissements cumulés">{formatMoney(state.accumulated, currency)}</Row>
                  <Row label="Valeur nette comptable">
                    <span className="text-base font-semibold text-primary">{formatMoney(state.netBookValue, currency)}</span>
                  </Row>
                  {asset.status === "DISPOSED" && (
                    <>
                      <Row label="Sortie">
                        {asset.disposalType ? DISPOSAL_TYPE_LABELS[asset.disposalType] : "—"} le {formatDate(asset.disposalDate)}
                      </Row>
                      <Row label="Prix de cession">{formatMoney(asset.disposalValue ? Number(asset.disposalValue) : 0, currency)}</Row>
                      {disposalEvent?.data && typeof disposalEvent.data === "object" && "gainOrLoss" in disposalEvent.data && (
                        <Row label="Plus / moins-value">{formatMoney(Number((disposalEvent.data as { gainOrLoss: number }).gainOrLoss), currency)}</Row>
                      )}
                    </>
                  )}
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan d&apos;amortissement</CardTitle>
              <CardDescription>
                {asset.depreciationMethod === "DECLINING"
                  ? "Dégressif — prorata en mois dès le mois de mise en service, bascule en linéaire sur la durée résiduelle."
                  : "Linéaire — prorata temporis en jours (base 360) dès la date de mise en service."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {schedule.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">Bien non amortissable.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exercice</TableHead>
                      <TableHead className="text-right">Base (VNC début)</TableHead>
                      <TableHead className="text-right">Taux</TableHead>
                      <TableHead className="text-right">Prorata</TableHead>
                      <TableHead className="text-right">Dotation</TableHead>
                      <TableHead className="text-right">Cumul</TableHead>
                      <TableHead className="text-right">VNC fin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedule.map((row) => (
                      <TableRow key={row.label} className={row.fiscalYear === currentYear ? "bg-accent/50" : undefined}>
                        <TableCell className="font-medium">
                          {row.label}
                          {row.mode === "LINEAR" && asset.depreciationMethod === "DECLINING" && (
                            <Badge variant="muted" className="ml-2">
                              linéaire
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular">{formatMoney(row.openingNetValue, currency)}</TableCell>
                        <TableCell className="text-right tabular">{row.rate.toFixed(2)} %</TableCell>
                        <TableCell className="text-right tabular">{row.partial ? `${Math.round(row.prorata * 100)} %` : "100 %"}</TableCell>
                        <TableCell className="text-right font-medium tabular">{formatMoney(row.annuity, currency)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(row.accumulated, currency)}</TableCell>
                        <TableCell className="text-right tabular">{formatMoney(row.closingNetValue, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" /> Historique immuable
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-success" /> Journal en ajout seul : aucune modification ni suppression possible (verrou base de données).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l pl-5">
                {asset.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular">{formatDateTime(e.createdAt)}</span>
                      <Badge variant="muted">{EVENT_TYPE_LABELS[e.type]}</Badge>
                      <span>{e.user?.name ?? "Système"}</span>
                      {e.campaign && (
                        <Link href={`/campaigns/${e.campaign.id}`} className="text-primary hover:underline">
                          {e.campaign.code}
                        </Link>
                      )}
                      {e.latitude !== null && e.longitude !== null && (
                        <a
                          className="inline-flex items-center gap-0.5 text-primary hover:underline"
                          href={`https://www.openstreetmap.org/?mlat=${e.latitude}&mlon=${e.longitude}#map=19/${e.latitude}/${e.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MapPin className="h-3 w-3" /> GPS
                        </a>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm">{e.summary}</p>
                    {(e.fromLocation || e.toLocation) && e.type === "LOCATION_TRANSFER" && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {e.fromLocation?.path ?? "Non localisé"} → {e.toLocation?.path ?? "Non localisé"}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Étiquette QR</CardTitle>
            </CardHeader>
            <CardContent>
              <AssetQrCard
                asset={{ id: asset.id, code: asset.code, designation: asset.designation, location: asset.location?.path ?? null }}
                companyName={company.name}
                appUrl={appUrl}
                canPrint={can(user.role, "label:print")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Localisation & affectation</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Localisation">
                  <span className="inline-flex items-start gap-1 text-left">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {asset.location?.path ?? "Non localisé"}
                  </span>
                </Row>
                <Row label="Direction / service">{asset.department?.name}</Row>
                <Row label="Centre de coût">{asset.costCenter ? `${asset.costCenter.code} — ${asset.costCenter.name}` : "—"}</Row>
                <Row label="Détenteur">
                  {asset.custodian ? (
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                      {asset.custodian.firstName} {asset.custodian.lastName}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Affectations & décharges signées</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentHistory items={assignments} />
            </CardContent>
          </Card>
          {asset.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{asset.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
