"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  BadgeCheck,
  Calculator,
  Camera,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  MessageSquareText,
  PackageMinus,
  PackagePlus,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  declareMissing,
  integrateSurplus,
  justifyResults,
  runReconciliation,
  sendToMaintenance,
  syncLocations,
} from "@/actions/reconciliation";
import { validateCampaign } from "@/actions/campaigns";
import { exportReconciliationWorkbook } from "@/lib/exports/reconciliation-xlsx";
import { generatePvPdf } from "@/lib/exports/pv-pdf";
import type { ReconRow, ReconciliationReport } from "@/lib/report-types";
import { RESOLUTION_ACTION_LABELS } from "@/lib/report-types";
import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_TONES,
  RECON_CATEGORY_LABELS,
  RECON_CATEGORY_LONG_LABELS,
  RECON_CATEGORY_TONES,
  RESOLUTION_STATUS_LABELS,
} from "@/lib/constants";
import { RECON_CATEGORIES, type ReconciliationCategoryValue } from "@/lib/domain";
import { formatDateTime, formatMoney, formatNumber, formatPercent, todayInput } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ActionResultLike = { ok: boolean; error?: string; message?: string };

export function ReconcileWorkspace({
  report,
  categories,
  canResolve,
  canManage,
}: {
  report: ReconciliationReport;
  categories: { id: string; name: string }[];
  canResolve: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const { campaign, summary, rows, company } = report;
  const cur = company.currency;
  const [tab, setTab] = useState<ReconciliationCategoryValue>(summary.byCategory.MISSING.count ? "MISSING" : summary.byCategory.MISPLACED.count ? "MISPLACED" : "MATCH");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [justify, setJustify] = useState<{ resolution: "RESOLVED" | "IGNORED" } | null>(null);
  const [note, setNote] = useState("");
  const [integrate, setIntegrate] = useState<ReconRow | null>(null);
  const [integration, setIntegration] = useState({ designation: "", categoryId: "", acquisitionValue: "", acquisitionDate: todayInput(), brand: "", model: "", serialNumber: "", note: "" });
  const [validateOpen, setValidateOpen] = useState(false);
  const [observations, setObservations] = useState(campaign.pvObservations ?? "");

  const resolvable = canResolve && campaign.status === "COUNT_CLOSED";
  const tabRows = useMemo(() => rows.filter((r) => r.category === tab), [rows, tab]);
  const selectedRows = tabRows.filter((r) => selected.has(r.id));
  const openCount = rows.filter((r) => r.category !== "MATCH" && r.resolution === "OPEN").length;

  const run = (fn: () => Promise<ActionResultLike>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Opération effectuée.");
      setSelected(new Set());
      after?.();
      router.refresh();
    });

  const ids = () => selectedRows.map((r) => r.id);
  const allSelected = tabRows.length > 0 && tabRows.every((r) => selected.has(r.id));

  const exportXlsx = () => {
    setExporting("xlsx");
    try {
      exportReconciliationWorkbook(report);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible.");
    } finally {
      setExporting(null);
    }
  };
  const exportPdf = async () => {
    setExporting("pdf");
    try {
      await generatePvPdf(report);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Génération du PV impossible.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {campaign.status === "IN_PROGRESS" && (
        <Alert variant="info">
          <Calculator />
          <AlertTitle>Rapprochement provisoire</AlertTitle>
          <AlertDescription>
            Le comptage est en cours : les résultats évoluent au fil des scans. Les régularisations seront disponibles après la clôture du comptage.
          </AlertDescription>
        </Alert>
      )}
      {campaign.status === "VALIDATED" && (
        <Alert variant="success">
          <ShieldCheck />
          <AlertTitle>
            {campaign.pvNumber} validé le {formatDateTime(campaign.validatedAt)} par {campaign.validatedBy}
          </AlertTitle>
          <AlertDescription>La campagne est verrouillée. Les exports reflètent l&apos;état définitif.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canManage && campaign.status !== "VALIDATED" && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => runReconciliation(campaign.id))}>
            {pending ? <Loader2 className="animate-spin" /> : <Calculator />} {rows.length ? "Recalculer" : "Calculer le rapprochement"}
          </Button>
        )}
        <Button variant="outline" onClick={exportXlsx} disabled={!rows.length || exporting !== null}>
          {exporting === "xlsx" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Classeur Excel des écarts
        </Button>
        <Button variant="outline" onClick={exportPdf} disabled={!rows.length || exporting !== null}>
          {exporting === "pdf" ? <Loader2 className="animate-spin" /> : <FileText />} {campaign.status === "VALIDATED" ? "PV d'inventaire (PDF)" : "Projet de PV (PDF)"}
        </Button>
        {canResolve && campaign.status === "COUNT_CLOSED" && (
          <Button className="ml-auto" onClick={() => setValidateOpen(true)} disabled={pending || !rows.length}>
            <BadgeCheck /> Valider le PV & verrouiller
          </Button>
        )}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {RECON_CATEGORIES.map((c) => {
          const b = summary.byCategory[c];
          return (
            <button
              key={c}
              onClick={() => {
                setTab(c);
                setSelected(new Set());
              }}
              className={cn("rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40", tab === c && "ring-2 ring-primary")}
            >
              <div className="flex items-center justify-between">
                <Badge variant={RECON_CATEGORY_TONES[c]}>{RECON_CATEGORY_LABELS[c]}</Badge>
                <span className="text-2xl font-semibold tabular">{formatNumber(b.count)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{RECON_CATEGORY_LONG_LABELS[c]}</p>
              <p className="mt-1 text-sm">
                VNC <strong className="tabular">{formatMoney(b.netBookValue, cur)}</strong>
              </p>
            </button>
          );
        })}
      </section>

      <Card>
        <CardContent className="grid gap-4 p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Fichier théorique</p>
            <p className="text-lg font-semibold tabular">{formatNumber(summary.theoreticalCount)} biens</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Taux de rapprochement physique</p>
            <p className="text-lg font-semibold tabular">{formatPercent(summary.physicalRate)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Taux de conformité</p>
            <p className="text-lg font-semibold tabular">{formatPercent(summary.conformityRate)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Écarts à traiter</p>
            <p className={cn("text-lg font-semibold tabular", openCount ? "text-[hsl(30_90%_32%)]" : "text-success")}>{formatNumber(openCount)}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as ReconciliationCategoryValue); setSelected(new Set()); }}>
        <TabsList>
          {RECON_CATEGORIES.map((c) => (
            <TabsTrigger key={c} value={c}>
              {RECON_CATEGORY_LABELS[c]} <span className="text-xs text-muted-foreground">({summary.byCategory[c].count})</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {RECON_CATEGORIES.map((c) => (
          <TabsContent key={c} value={c}>
            <Card className="overflow-hidden">
              {resolvable && (
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
                  <span className="mr-2 text-sm text-muted-foreground">{selectedRows.length} sélectionné(s)</span>
                  {c === "MISPLACED" && (
                    <Button size="sm" disabled={pending || !selectedRows.length} onClick={() => run(() => syncLocations({ campaignId: campaign.id, resultIds: ids() }))}>
                      <ArrowRightLeft /> Synchroniser la localisation comptable
                    </Button>
                  )}
                  {c === "MISSING" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending || !selectedRows.length}
                      onClick={() => {
                        if (window.confirm(`Déclarer ${selectedRows.length} bien(s) disparu(s) dans le registre ?`)) {
                          run(() => declareMissing({ campaignId: campaign.id, resultIds: ids() }));
                        }
                      }}
                    >
                      <PackageMinus /> Déclarer disparu(s)
                    </Button>
                  )}
                  {c === "SURPLUS" && (
                    <Button
                      size="sm"
                      disabled={pending || selectedRows.length !== 1 || !selectedRows[0]?.surplusId || selectedRows[0]?.resolution !== "OPEN"}
                      onClick={() => {
                        const r = selectedRows[0];
                        setIntegration({ designation: r.designation, categoryId: categories.find((x) => x.name === r.categoryName)?.id ?? "", acquisitionValue: String(r.grossValue || ""), acquisitionDate: todayInput(), brand: "", model: "", serialNumber: r.serialNumber ?? "", note: "" });
                        setIntegrate(r);
                      }}
                    >
                      <PackagePlus /> Intégrer à l&apos;actif
                    </Button>
                  )}
                  {(c === "MATCH" || c === "MISPLACED") && (
                    <Button size="sm" variant="outline" disabled={pending || !selectedRows.some((r) => r.condition && r.condition !== "GOOD")} onClick={() => run(() => sendToMaintenance({ campaignId: campaign.id, resultIds: ids() }))}>
                      <Wrench /> Passer en maintenance
                    </Button>
                  )}
                  {c !== "MATCH" && (
                    <>
                      <Button size="sm" variant="outline" disabled={pending || !selectedRows.length} onClick={() => { setNote(""); setJustify({ resolution: "RESOLVED" }); }}>
                        <MessageSquareText /> Justifier
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending || !selectedRows.length} onClick={() => { setNote(""); setJustify({ resolution: "IGNORED" }); }}>
                        Classer sans suite
                      </Button>
                    </>
                  )}
                </div>
              )}
              {tabRows.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {rows.length ? "Aucun élément dans cette catégorie." : "Rapprochement non calculé."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {resolvable && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allSelected ? true : selectedRows.length ? "indeterminate" : false}
                            onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(tabRows.map((r) => r.id)))}
                            aria-label="Tout sélectionner"
                          />
                        </TableHead>
                      )}
                      <TableHead>Code</TableHead>
                      <TableHead>Désignation</TableHead>
                      <TableHead className="hidden lg:table-cell">{c === "SURPLUS" ? "Trouvé à" : "Localisation comptable"}</TableHead>
                      {(c === "MISPLACED" || c === "MATCH") && <TableHead className="hidden lg:table-cell">Constaté à</TableHead>}
                      <TableHead className="hidden md:table-cell">Constat</TableHead>
                      <TableHead className="text-right">VNC</TableHead>
                      <TableHead>Régularisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tabRows.map((r) => (
                      <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                        {resolvable && (
                          <TableCell>
                            <Checkbox
                              checked={selected.has(r.id)}
                              onCheckedChange={() =>
                                setSelected((s) => {
                                  const n = new Set(s);
                                  if (n.has(r.id)) n.delete(r.id);
                                  else n.add(r.id);
                                  return n;
                                })
                              }
                              aria-label={`Sélectionner ${r.assetCode}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {r.assetId ? (
                            <Link href={`/assets/${r.assetId}`} className="text-primary hover:underline">
                              {r.assetCode}
                            </Link>
                          ) : (
                            r.assetCode
                          )}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          <span className="block truncate font-medium">{r.designation}</span>
                          <span className="block text-xs text-muted-foreground">{r.reasons.join(" · ")}</span>
                        </TableCell>
                        <TableCell className="hidden max-w-[240px] text-xs text-muted-foreground lg:table-cell">
                          {c === "SURPLUS" ? r.foundLocationPath : r.expectedLocationPath ?? "—"}
                        </TableCell>
                        {(c === "MISPLACED" || c === "MATCH") && <TableCell className="hidden max-w-[240px] text-xs lg:table-cell">{r.foundLocationPath ?? "—"}</TableCell>}
                        <TableCell className="hidden md:table-cell">
                          <span className="flex items-center gap-1.5">
                            {r.condition && <Badge variant={ASSET_CONDITION_TONES[r.condition]}>{ASSET_CONDITION_LABELS[r.condition]}</Badge>}
                            {r.photoKey && (
                              <a href={`/api/files/${r.photoKey}`} target="_blank" rel="noreferrer" className="text-primary" aria-label="Voir la photo">
                                <Camera className="h-4 w-4" />
                              </a>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular">{formatMoney(r.netBookValue, cur)}</TableCell>
                        <TableCell>
                          <Badge variant={r.resolution === "RESOLVED" ? "success" : r.resolution === "IGNORED" ? "muted" : "warning"}>
                            {r.resolution === "RESOLVED" && <CheckCircle2 className="h-3 w-3" />}
                            {r.resolutionAction && r.resolutionAction !== "CONFORME" ? RESOLUTION_ACTION_LABELS[r.resolutionAction] ?? r.resolutionAction : RESOLUTION_STATUS_LABELS[r.resolution]}
                          </Badge>
                          {r.resolutionNote && <span className="mt-0.5 block max-w-[220px] truncate text-xs text-muted-foreground" title={r.resolutionNote}>{r.resolutionNote}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!justify} onOpenChange={(o) => !o && setJustify(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{justify?.resolution === "IGNORED" ? "Classer sans suite" : "Justifier l'écart"}</DialogTitle>
            <DialogDescription>
              {selectedRows.length} ligne(s) — aucune écriture dans le registre ; la justification figurera au PV.
            </DialogDescription>
          </DialogHeader>
          <Field label="Justification" required>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bien en réparation chez le fournisseur (BL n°…), bien de tiers en location…" />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || note.trim().length < 3}
              onClick={() => run(() => justifyResults({ campaignId: campaign.id, resultIds: ids(), resolution: justify!.resolution, note }), () => setJustify(null))}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!integrate} onOpenChange={(o) => !o && setIntegrate(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Intégrer l&apos;excédent {integrate?.assetCode} à l&apos;actif</DialogTitle>
            <DialogDescription>Une fiche immobilisation (origine : excédent d&apos;inventaire) sera créée à la localisation constatée.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Désignation" required className="sm:col-span-2">
              <Input value={integration.designation} onChange={(e) => setIntegration({ ...integration, designation: e.target.value })} />
            </Field>
            <Field label="Catégorie comptable" required>
              <NativeSelect value={integration.categoryId} onChange={(e) => setIntegration({ ...integration, categoryId: e.target.value })}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={`Valeur retenue HT (${cur})`} required hint="Valeur d'acquisition justifiée ou valeur vénale estimée.">
              <Input type="number" step="0.01" min={0} value={integration.acquisitionValue} onChange={(e) => setIntegration({ ...integration, acquisitionValue: e.target.value })} />
            </Field>
            <Field label="Date d'entrée" required>
              <Input type="date" value={integration.acquisitionDate} onChange={(e) => setIntegration({ ...integration, acquisitionDate: e.target.value })} />
            </Field>
            <Field label="N° de série">
              <Input value={integration.serialNumber} onChange={(e) => setIntegration({ ...integration, serialNumber: e.target.value })} />
            </Field>
            <Field label="Marque">
              <Input value={integration.brand} onChange={(e) => setIntegration({ ...integration, brand: e.target.value })} />
            </Field>
            <Field label="Modèle">
              <Input value={integration.model} onChange={(e) => setIntegration({ ...integration, model: e.target.value })} />
            </Field>
            <Field label="Justification" className="sm:col-span-2">
              <Textarea value={integration.note} onChange={(e) => setIntegration({ ...integration, note: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !integration.designation || !integration.categoryId || !integration.acquisitionValue}
              onClick={() =>
                run(
                  () =>
                    integrateSurplus({
                      campaignId: campaign.id,
                      resultId: integrate!.id,
                      ...integration,
                      acquisitionValue: Number(integration.acquisitionValue),
                    }),
                  () => setIntegrate(null),
                )
              }
            >
              <PackagePlus /> Créer la fiche
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Valider le procès-verbal d&apos;inventaire</DialogTitle>
            <DialogDescription>
              Un numéro de PV sera attribué et la campagne sera définitivement verrouillée.
              {openCount > 0 && ` Attention : ${openCount} écart(s) restent à traiter et figureront « en cours d'analyse ».`}
            </DialogDescription>
          </DialogHeader>
          <Field label="Observations et réserves (reprises au PV)">
            <Textarea rows={6} value={observations} onChange={(e) => setObservations(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await validateCampaign(campaign.id, observations);
                  return res.ok ? { ok: true, message: `PV ${res.data.pvNumber} validé.` } : res;
                }, () => setValidateOpen(false))
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Valider le PV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
