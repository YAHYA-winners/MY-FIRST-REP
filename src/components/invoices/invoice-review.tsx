"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Loader2,
  Package,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { approveInvoice, rejectInvoice } from "@/actions/invoices";
import { checkConsistency } from "@/lib/invoice-normalization";
import { emptyLine, type LineDraft, type ReviewDraft } from "@/lib/invoice-draft";
import { InvoiceViewer } from "@/components/invoices/invoice-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VAT_RATES } from "@/lib/constants";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn, round2 } from "@/lib/utils";

interface Option {
  id: string;
  label: string;
}

export interface InvoiceReviewProps {
  invoice: {
    id: string;
    status: string;
    fileName: string;
    mimeType: string;
    fileUrl: string;
    model: string | null;
    durationMs: number | null;
    confidence: number | null;
    error: string | null;
    documentTypeLabel: string | null;
    warnings: string[];
  };
  initial: ReviewDraft;
  categories: { id: string; code: string; name: string; assetAccount: string }[];
  locations: Option[];
  costCenters: Option[];
  departments: Option[];
  threshold: number;
  canValidate: boolean;
}

const num = (v: string) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function serialList(text: string): string[] {
  return text
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function InvoiceReview({ invoice, initial, categories, locations, costCenters, departments, threshold, canValidate }: InvoiceReviewProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ReviewDraft>(initial);
  const [initialStatus, setInitialStatus] = useState<"IN_STOCK" | "IN_SERVICE">("IN_STOCK");
  const [commissioningDate, setCommissioningDate] = useState("");
  const [defaultLocationId, setDefaultLocationId] = useState("");
  const [defaultCostCenterId, setDefaultCostCenterId] = useState("");
  const [defaultDepartmentId, setDefaultDepartmentId] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [pending, start] = useTransition();
  const currency = draft.currency || "MAD";

  const setHeader = <K extends keyof Omit<ReviewDraft, "lines" | "supplier">>(k: K, v: ReviewDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSupplier = (k: keyof ReviewDraft["supplier"], v: string) => setDraft((d) => ({ ...d, supplier: { ...d.supplier, [k]: v } }));
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) }));

  const checks = useMemo(
    () =>
      checkConsistency({
        totalHT: draft.totalHT === "" ? null : num(draft.totalHT),
        totalVAT: draft.totalVAT === "" ? null : num(draft.totalVAT),
        totalTTC: draft.totalTTC === "" ? null : num(draft.totalTTC),
        lines: draft.lines.map((l) => ({ quantity: num(l.quantity), unitPriceHT: num(l.unitPriceHT), vatRate: num(l.vatRate) })),
      }),
    [draft],
  );

  const summary = useMemo(() => {
    let cards = 0;
    let capitalised = 0;
    let expensed = 0;
    for (const l of draft.lines) {
      const total = round2(num(l.quantity) * num(l.unitPriceHT));
      if (l.isFixedAsset) {
        const q = num(l.quantity);
        cards += l.splitIntoUnits && Number.isInteger(q) && q > 1 ? q : 1;
        capitalised += total;
      } else expensed += total;
    }
    return { cards, capitalised: round2(capitalised), expensed: round2(expensed) };
  }, [draft.lines]);

  const blocking = draft.lines.filter((l) => l.isFixedAsset && !l.categoryId).length;
  const readOnly = invoice.status === "VALIDATED" || invoice.status === "REJECTED" || !canValidate;

  const submit = () =>
    start(async () => {
      const res = await approveInvoice({
        invoiceId: invoice.id,
        supplier: draft.supplier,
        number: draft.number,
        invoiceDate: draft.invoiceDate,
        currency: draft.currency,
        totalHT: num(draft.totalHT),
        totalVAT: num(draft.totalVAT),
        totalTTC: num(draft.totalTTC),
        commissioningDate: commissioningDate || null,
        defaultLocationId,
        defaultCostCenterId,
        defaultDepartmentId,
        initialStatus,
        allowDuplicate,
        lines: draft.lines.map((l) => ({
          designation: l.designation,
          specifications: l.specifications,
          brand: l.brand,
          model: l.model,
          serialNumbers: serialList(l.serials),
          quantity: num(l.quantity),
          unitPriceHT: num(l.unitPriceHT),
          vatRate: num(l.vatRate),
          isFixedAsset: l.isFixedAsset,
          splitIntoUnits: l.splitIntoUnits,
          categoryId: l.isFixedAsset ? l.categoryId : null,
          aiCategoryCode: l.aiCategoryCode,
          aiConfidence: l.aiConfidence,
        })),
      });
      setConfirmOpen(false);
      if (!res.ok) {
        if (res.error.startsWith("DUPLICATE:")) setDuplicateError(res.error.replace("DUPLICATE:", "").trim());
        toast.error(res.error.replace("DUPLICATE:", "").trim());
        return;
      }
      toast.success(
        res.data.assetCount
          ? `${res.data.assetCount} fiche(s) immobilisation créée(s) : ${res.data.firstCode}${res.data.assetCount > 1 ? ` → ${res.data.lastCode}` : ""}`
          : "Facture validée (aucune immobilisation générée).",
      );
      router.refresh();
    });

  const reject = () =>
    start(async () => {
      const res = await rejectInvoice(invoice.id, rejectReason);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setRejectOpen(false);
      router.push("/invoices/import");
    });

  const dataPanel = (
    <div className="space-y-4">
      {invoice.status === "EXTRACTED" && (
        <Alert variant="info">
          <Sparkles />
          <AlertTitle>
            Extraction IA {invoice.model ? `(${invoice.model})` : ""} — confiance {Math.round((invoice.confidence ?? 0) * 100)} %
          </AlertTitle>
          <AlertDescription>
            {invoice.documentTypeLabel && <span>Type détecté : {invoice.documentTypeLabel}. </span>}
            {invoice.durationMs ? `Analyse en ${(invoice.durationMs / 1000).toFixed(1)} s. ` : ""}Vérifiez chaque valeur en vis-à-vis du document avant validation.
          </AlertDescription>
        </Alert>
      )}
      {invoice.status === "FAILED" && (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Extraction impossible</AlertTitle>
          <AlertDescription>{invoice.error} — vous pouvez relancer l&apos;extraction ou saisir les données manuellement.</AlertDescription>
        </Alert>
      )}
      {invoice.warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Points d&apos;attention</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {invoice.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">En-tête de facture</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Fournisseur" required className="sm:col-span-2">
            <Input value={draft.supplier.name} onChange={(e) => setSupplier("name", e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="ICE fournisseur" hint="15 chiffres">
            <Input value={draft.supplier.ice} onChange={(e) => setSupplier("ice", e.target.value)} disabled={readOnly} inputMode="numeric" />
          </Field>
          <Field label="IF / RC">
            <div className="flex gap-2">
              <Input value={draft.supplier.taxId} onChange={(e) => setSupplier("taxId", e.target.value)} placeholder="IF" disabled={readOnly} />
              <Input value={draft.supplier.tradeRegister} onChange={(e) => setSupplier("tradeRegister", e.target.value)} placeholder="RC" disabled={readOnly} />
            </div>
          </Field>
          <Field label="N° de facture" required>
            <Input value={draft.number} onChange={(e) => setHeader("number", e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Date de facture" required>
            <Input type="date" value={draft.invoiceDate} onChange={(e) => setHeader("invoiceDate", e.target.value)} disabled={readOnly} />
          </Field>
          <div className="grid grid-cols-4 gap-2 sm:col-span-2">
            <Field label="Devise">
              <Input value={draft.currency} maxLength={3} onChange={(e) => setHeader("currency", e.target.value.toUpperCase())} disabled={readOnly} />
            </Field>
            <Field label="Total HT">
              <Input type="number" step="0.01" value={draft.totalHT} onChange={(e) => setHeader("totalHT", e.target.value)} disabled={readOnly} />
            </Field>
            <Field label="Total TVA">
              <Input type="number" step="0.01" value={draft.totalVAT} onChange={(e) => setHeader("totalVAT", e.target.value)} disabled={readOnly} />
            </Field>
            <Field label="Total TTC">
              <Input type="number" step="0.01" value={draft.totalTTC} onChange={(e) => setHeader("totalTTC", e.target.value)} disabled={readOnly} />
            </Field>
          </div>
          <ul className="grid gap-1 sm:col-span-2">
            {checks.map((c) => (
              <li key={c.key} className={cn("flex items-center gap-2 text-xs", c.ok ? "text-success" : "text-[hsl(30_90%_32%)]")}>
                {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                <span className="font-medium">{c.label}</span>
                {!c.ok && c.key !== "line_arithmetic" && c.delta !== null && <span>— écart {formatMoney(c.delta, currency)}</span>}
                {c.detail && !c.ok && <span className="text-muted-foreground">({c.detail})</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Lignes détectées ({draft.lines.length})</CardTitle>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}>
              <Plus /> Ligne
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.lines.length === 0 && <p className="text-sm text-muted-foreground">Aucune ligne : ajoutez-les manuellement.</p>}
          {draft.lines.map((l, index) => {
            const qty = num(l.quantity);
            const total = round2(qty * num(l.unitPriceHT));
            const serials = serialList(l.serials);
            const canSplit = l.isFixedAsset && Number.isInteger(qty) && qty > 1;
            const units = canSplit && l.splitIntoUnits ? qty : 1;
            const open = expanded.has(l.key);
            return (
              <div key={l.key} className={cn("rounded-lg border p-3", l.isFixedAsset ? "border-primary/30 bg-accent/30" : "bg-muted/30")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-6 w-6 place-content-center rounded bg-muted text-xs font-semibold">{index + 1}</span>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox checked={l.isFixedAsset} onCheckedChange={(v) => setLine(l.key, { isFixedAsset: v === true })} disabled={readOnly} />
                    {l.isFixedAsset ? "Immobilisation" : "Charge / consommable"}
                  </label>
                  {l.aiConfidence !== null && (
                    <Badge variant={l.aiConfidence >= 0.8 ? "success" : l.aiConfidence >= 0.5 ? "warning" : "destructive"}>
                      IA {Math.round(l.aiConfidence * 100)} %
                    </Badge>
                  )}
                  {l.belowThreshold && l.isFixedAsset && <Badge variant="warning">Sous le seuil ({formatMoney(threshold, currency, 0)})</Badge>}
                  <span className="ml-auto text-sm font-semibold tabular">{formatMoney(total, currency)}</span>
                  {!readOnly && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(l.key)} aria-label="Supprimer la ligne">
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-6">
                  <Field label="Désignation" className="sm:col-span-6">
                    <Input value={l.designation} onChange={(e) => setLine(l.key, { designation: e.target.value })} disabled={readOnly} />
                  </Field>
                  <Field label="Marque" className="sm:col-span-2">
                    <Input value={l.brand} onChange={(e) => setLine(l.key, { brand: e.target.value })} disabled={readOnly} />
                  </Field>
                  <Field label="Modèle" className="sm:col-span-2">
                    <Input value={l.model} onChange={(e) => setLine(l.key, { model: e.target.value })} disabled={readOnly} />
                  </Field>
                  <Field label="Catégorie comptable" className="sm:col-span-2" error={l.isFixedAsset && !l.categoryId ? "Requise" : undefined}>
                    <NativeSelect value={l.categoryId} onChange={(e) => setLine(l.key, { categoryId: e.target.value })} disabled={readOnly || !l.isFixedAsset}>
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.assetAccount} — {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Quantité" className="sm:col-span-2">
                    <Input type="number" step="any" min={0} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} disabled={readOnly} />
                  </Field>
                  <Field label="P.U. HT" className="sm:col-span-2">
                    <Input type="number" step="0.01" min={0} value={l.unitPriceHT} onChange={(e) => setLine(l.key, { unitPriceHT: e.target.value })} disabled={readOnly} />
                  </Field>
                  <Field label="TVA %" className="sm:col-span-2">
                    <NativeSelect value={l.vatRate} onChange={(e) => setLine(l.key, { vatRate: e.target.value })} disabled={readOnly}>
                      {[...new Set([...VAT_RATES.map(String), l.vatRate])].map((r) => (
                        <option key={r} value={r}>
                          {r} %
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                {l.rationale && <p className="mt-2 text-xs italic text-muted-foreground">IA : {l.rationale}</p>}
                {l.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-[hsl(30_90%_32%)]">
                    {l.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
                {l.isFixedAsset && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                    {canSplit ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={l.splitIntoUnits} onCheckedChange={(v) => setLine(l.key, { splitIntoUnits: v === true })} disabled={readOnly} />
                        <Scissors className="h-3.5 w-3.5" /> Scinder en {qty} fiches individuelles
                      </label>
                    ) : (
                      <span className="text-xs text-muted-foreground">1 fiche{qty > 1 ? ` (lot de ${formatNumber(qty, 0)})` : ""}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {serials.length} n° de série {serials.length && units > 1 && serials.length !== units ? `(≠ ${units} unités)` : ""}
                    </span>
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(l.key)) n.delete(l.key); else n.add(l.key); return n; })}>
                      {open ? <ChevronUp /> : <ChevronDown />} Séries & aperçu
                    </Button>
                  </div>
                )}
                {l.isFixedAsset && open && (
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <Field label="Numéros de série (un par ligne)">
                      <Textarea rows={Math.min(8, Math.max(3, units))} value={l.serials} onChange={(e) => setLine(l.key, { serials: e.target.value })} disabled={readOnly} className="font-mono text-xs" />
                    </Field>
                    <Field label="Caractéristiques techniques">
                      <Textarea rows={3} value={l.specifications} onChange={(e) => setLine(l.key, { specifications: e.target.value })} disabled={readOnly} />
                    </Field>
                    <div className="md:col-span-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Fiches qui seront générées</p>
                      <ul className="max-h-48 divide-y overflow-auto rounded-md border bg-card text-xs">
                        {Array.from({ length: Math.min(units, 200) }).map((_, u) => (
                          <li key={u} className="flex items-center justify-between gap-2 px-2 py-1.5">
                            <span className="flex items-center gap-1.5">
                              <Package className="h-3 w-3 text-muted-foreground" /> IMM-…-{String(u + 1).padStart(2, "0")} · {l.designation || "—"}
                            </span>
                            <span className="font-mono text-muted-foreground">{units > 1 ? serials[u] ?? "sans n° de série" : serials.join(", ") || "sans n° de série"}</span>
                            <span className="tabular">{formatMoney(units > 1 ? num(l.unitPriceHT) : total, currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Paramètres des fiches générées</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Statut initial">
              <NativeSelect value={initialStatus} onChange={(e) => setInitialStatus(e.target.value as "IN_STOCK" | "IN_SERVICE")}>
                <option value="IN_STOCK">En stock / Non affecté</option>
                <option value="IN_SERVICE">En service</option>
              </NativeSelect>
            </Field>
            <Field label="Date de mise en service" hint={initialStatus === "IN_SERVICE" ? "Par défaut : date de facture." : "À renseigner lors de l'affectation."}>
              <Input type="date" value={commissioningDate} onChange={(e) => setCommissioningDate(e.target.value)} />
            </Field>
            <Field label="Localisation initiale">
              <NativeSelect value={defaultLocationId} onChange={(e) => setDefaultLocationId(e.target.value)}>
                <option value="">— Non localisé —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Centre de coût">
              <NativeSelect value={defaultCostCenterId} onChange={(e) => setDefaultCostCenterId(e.target.value)}>
                <option value="">—</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Direction / service" className="sm:col-span-2">
              <NativeSelect value={defaultDepartmentId} onChange={(e) => setDefaultDepartmentId(e.target.value)}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="hidden gap-4 lg:grid lg:h-[calc(100dvh-12.5rem)] lg:grid-cols-2">
        <InvoiceViewer url={invoice.fileUrl} mimeType={invoice.mimeType} fileName={invoice.fileName} />
        <div className="overflow-y-auto pr-1 scrollbar-thin">{dataPanel}</div>
      </div>
      <Tabs defaultValue="data" className="lg:hidden">
        <TabsList className="w-full">
          <TabsTrigger value="doc" className="flex-1">
            Document
          </TabsTrigger>
          <TabsTrigger value="data" className="flex-1">
            Données extraites
          </TabsTrigger>
        </TabsList>
        <TabsContent value="doc" className="h-[70dvh]">
          <InvoiceViewer url={invoice.fileUrl} mimeType={invoice.mimeType} fileName={invoice.fileName} />
        </TabsContent>
        <TabsContent value="data">{dataPanel}</TabsContent>
      </Tabs>

      {!readOnly && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t bg-card/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>
                <strong className="tabular">{summary.cards}</strong> fiche(s) à générer
              </span>
              <span className="text-muted-foreground">
                Immobilisé : <strong className="tabular text-foreground">{formatMoney(summary.capitalised, currency)}</strong>
              </span>
              <span className="text-muted-foreground">
                En charges : <span className="tabular">{formatMoney(summary.expensed, currency)}</span>
              </span>
              {duplicateError && (
                <label className="flex items-center gap-2 text-xs text-destructive">
                  <Checkbox checked={allowDuplicate} onCheckedChange={(v) => setAllowDuplicate(v === true)} />
                  Autoriser le doublon ({duplicateError.slice(0, 80)}…)
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={pending}>
                <Ban /> Rejeter
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={pending || blocking > 0 || !draft.number || !draft.invoiceDate || !draft.supplier.name || draft.lines.length === 0}>
                {pending ? <Loader2 className="animate-spin" /> : <FileCheck2 />} Approuver & générer les fiches
              </Button>
            </div>
          </div>
          {blocking > 0 && <p className="mt-1 text-xs text-destructive">{blocking} ligne(s) immobilisable(s) sans catégorie comptable.</p>}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la validation</DialogTitle>
            <DialogDescription>
              {summary.cards} fiche(s) immobilisation pour {formatMoney(summary.capitalised, currency)} HT seront créées, numérotées et rattachées à la facture{" "}
              {draft.number} de {draft.supplier.name}. Cette opération est tracée dans l&apos;historique.
            </DialogDescription>
          </DialogHeader>
          {checks.some((c) => !c.ok) && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>Des incohérences arithmétiques subsistent : vérifiez remises et frais avant de confirmer.</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <FileCheck2 />} Valider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter le document</DialogTitle>
            <DialogDescription>Le document sera archivé sans génération d&apos;immobilisation (ex. : devis, bon de livraison, facture de service).</DialogDescription>
          </DialogHeader>
          <Field label="Motif" required>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="destructive" onClick={reject} disabled={pending || rejectReason.trim().length < 3}>
              Rejeter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {invoice.status === "VALIDATED" && (
        <p className="text-sm text-muted-foreground">
          Facture validée — consultez les fiches générées dans le{" "}
          <Link href="/assets" className="text-primary hover:underline">
            registre
          </Link>
          .
        </p>
      )}
    </div>
  );
}
