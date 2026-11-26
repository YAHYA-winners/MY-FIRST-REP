"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { CheckCheck, Loader2, MapPin, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { markLabelsAffixed, markLabelsPrinted } from "@/actions/labels";
import { buildLabelsPdf, openPdfForPrint } from "@/lib/exports/labels-pdf";
import { LABEL_TEMPLATES, labelSlotPosition, labelsPerPage, validateTemplate, type LabelItem, type LabelTemplate } from "@/lib/labels";
import { assetQrPayload, locationQrPayload } from "@/lib/codes";
import { TAG_STATUS_LABELS, TAG_STATUS_TONES, LOCATION_TYPE_LABELS } from "@/lib/constants";
import { TAG_STATUSES, type LocationTypeValue, type TagStatusValue } from "@/lib/domain";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AssetRow {
  id: string;
  code: string;
  designation: string;
  serialNumber: string | null;
  tagStatus: TagStatusValue;
  tagPrintedAt: string | null;
  categoryId: string;
  locationPath: string | null;
  locationName: string | null;
}

interface LocationRow {
  id: string;
  code: string;
  name: string;
  path: string;
  type: LocationTypeValue;
}

const CUSTOM_DEFAULT: LabelTemplate = {
  key: "custom",
  name: "Format personnalisé",
  kind: "custom",
  pageWidth: 210,
  pageHeight: 297,
  labelWidth: 60,
  labelHeight: 30,
  columns: 3,
  rows: 9,
  marginTop: 8,
  marginLeft: 10,
  gapX: 5,
  gapY: 2,
};

export function LabelStudio({
  companyName,
  appUrl,
  assets,
  categories,
  locations,
}: {
  companyName: string;
  appUrl: string;
  assets: AssetRow[];
  categories: { id: string; name: string }[];
  locations: LocationRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"assets" | "locations">("assets");
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<TagStatusValue | "">("UNTAGGED");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [templateKey, setTemplateKey] = useState("thermal-50x25");
  const [custom, setCustom] = useState<LabelTemplate>(CUSTOM_DEFAULT);
  const [showCompany, setShowCompany] = useState(true);
  const [showTitle, setShowTitle] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const [drawBorders, setDrawBorders] = useState(false);
  const [startPosition, setStartPosition] = useState(0);
  const [pending, start] = useTransition();

  const template = templateKey === "custom" ? custom : LABEL_TEMPLATES.find((t) => t.key === templateKey) ?? LABEL_TEMPLATES[0];
  const templateError = validateTemplate(template);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter(
      (a) =>
        (!tagFilter || a.tagStatus === tagFilter) &&
        (!categoryFilter || a.categoryId === categoryFilter) &&
        (!needle ||
          a.code.toLowerCase().includes(needle) ||
          a.designation.toLowerCase().includes(needle) ||
          (a.serialNumber ?? "").toLowerCase().includes(needle) ||
          (a.locationPath ?? "").toLowerCase().includes(needle)),
    );
  }, [assets, q, tagFilter, categoryFilter]);

  const filteredLocations = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return locations.filter((l) => !needle || l.path.toLowerCase().includes(needle) || l.code.toLowerCase().includes(needle));
  }, [locations, q]);

  const items: LabelItem[] = useMemo(() => {
    if (tab === "assets") {
      return assets
        .filter((a) => selected.has(a.id))
        .map((a) => ({ id: a.id, code: a.code, qrPayload: assetQrPayload(a.code, appUrl), title: a.designation, subtitle: a.locationName ?? a.locationPath }));
    }
    return locations
      .filter((l) => selectedLocations.has(l.id))
      .map((l) => ({ id: l.id, code: l.code, qrPayload: locationQrPayload(l.code), title: l.name, subtitle: l.path }));
  }, [tab, assets, locations, selected, selectedLocations, appUrl]);

  const allFilteredSelected = tab === "assets" ? filtered.length > 0 && filtered.every((a) => selected.has(a.id)) : filteredLocations.length > 0 && filteredLocations.every((l) => selectedLocations.has(l.id));
  const someSelected = tab === "assets" ? filtered.some((a) => selected.has(a.id)) : filteredLocations.some((l) => selectedLocations.has(l.id));

  const toggleAll = () => {
    if (tab === "assets") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (allFilteredSelected) filtered.forEach((a) => next.delete(a.id));
        else filtered.forEach((a) => next.add(a.id));
        return next;
      });
    } else {
      setSelectedLocations((prev) => {
        const next = new Set(prev);
        if (allFilteredSelected) filteredLocations.forEach((l) => next.delete(l.id));
        else filteredLocations.forEach((l) => next.add(l.id));
        return next;
      });
    }
  };

  const toggle = (id: string) => {
    const setter = tab === "assets" ? setSelected : setSelectedLocations;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const perPage = labelsPerPage(template);
  const isSheet = template.kind !== "thermal";
  const pages = items.length ? Math.ceil(((isSheet ? startPosition : 0) + items.length) / perPage) : 0;

  const generate = () =>
    start(async () => {
      if (!items.length) return void toast.error("Sélectionnez au moins une étiquette.");
      if (templateError) return void toast.error(templateError);
      try {
        const doc = await buildLabelsPdf(items, { template, companyName, showCompany, showTitle, showSubtitle, startPosition, drawBorders });
        openPdfForPrint(doc, `Etiquettes_QR_${new Date().toISOString().slice(0, 10)}.pdf`);
        if (tab === "assets") {
          const res = await markLabelsPrinted({ assetIds: items.map((i) => i.id), templateKey: template.key });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`${res.data.printed} étiquette(s) générée(s) — ${res.data.firstPrints} première(s) impression(s).`);
          setSelected(new Set());
          router.refresh();
        } else {
          toast.success(`${items.length} étiquette(s) de localisation générée(s).`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec de la génération du PDF.");
      }
    });

  const confirmAffixed = () =>
    start(async () => {
      const res = await markLabelsAffixed({ assetIds: items.map((i) => i.id) });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setSelected(new Set());
      router.refresh();
    });

  const previewItems = items.slice(0, Math.max(0, perPage - (isSheet ? startPosition : 0)));
  const previewTemplate = isSheet ? template : { ...template, columns: Math.min(4, Math.max(1, items.length)), rows: 1, pageWidth: template.labelWidth * Math.min(4, Math.max(1, items.length)) + 3 * (Math.min(4, Math.max(1, items.length)) - 1), gapX: 3 };

  return (
    <div className="grid gap-6 2xl:grid-cols-[1fr_520px]">
      <Card className="min-w-0">
        <CardHeader className="gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "assets" | "locations")}>
            <TabsList>
              <TabsTrigger value="assets">Immobilisations</TabsTrigger>
              <TabsTrigger value="locations">
                <MapPin className="h-3.5 w-3.5" /> QR des locaux
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-8" />
            </div>
            {tab === "assets" && (
              <>
                <NativeSelect value={tagFilter} onChange={(e) => setTagFilter(e.target.value as TagStatusValue | "")} aria-label="Statut d'étiquetage">
                  <option value="">Tous statuts</option>
                  {TAG_STATUSES.map((t) => (
                    <option key={t} value={t}>
                      {TAG_STATUS_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Catégorie">
                  <option value="">Toutes catégories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 border-y bg-muted/40 px-4 py-2 text-sm">
            <Checkbox checked={allFilteredSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Tout sélectionner" />
            <span className="text-muted-foreground">
              {formatNumber(tab === "assets" ? filtered.length : filteredLocations.length)} élément(s) · {formatNumber(items.length)} sélectionné(s)
            </span>
          </div>
          <ul className="max-h-[62dvh] divide-y overflow-y-auto scrollbar-thin">
            {tab === "assets" &&
              filtered.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                    <span className="w-36 shrink-0 font-mono text-xs font-medium">{a.code}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{a.designation}</span>
                      <span className="block truncate text-xs text-muted-foreground">{a.locationPath ?? "Non localisé"}</span>
                    </span>
                    <Badge variant={TAG_STATUS_TONES[a.tagStatus]} className="hidden sm:inline-flex">
                      {TAG_STATUS_LABELS[a.tagStatus]}
                    </Badge>
                  </label>
                </li>
              ))}
            {tab === "locations" &&
              filteredLocations.map((l) => (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <Checkbox checked={selectedLocations.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                    <span className="w-36 shrink-0 font-mono text-xs font-medium">{l.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{l.path}</span>
                    <Badge variant="muted" className="hidden sm:inline-flex">
                      {LOCATION_TYPE_LABELS[l.type]}
                    </Badge>
                  </label>
                </li>
              ))}
            {(tab === "assets" ? filtered.length : filteredLocations.length) === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">Aucun élément ne correspond aux filtres.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Support d&apos;impression</CardTitle>
            <CardDescription>
              {items.length ? `${items.length} étiquette(s) · ${pages} page(s)` : "Aucune étiquette sélectionnée"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Format">
              <NativeSelect value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                {LABEL_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
                <option value="custom">Format personnalisé…</option>
              </NativeSelect>
            </Field>
            {templateKey === "custom" && (
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["pageWidth", "Page L (mm)"],
                    ["pageHeight", "Page H (mm)"],
                    ["labelWidth", "Étiq. L"],
                    ["labelHeight", "Étiq. H"],
                    ["columns", "Colonnes"],
                    ["rows", "Lignes"],
                    ["marginLeft", "Marge G"],
                    ["marginTop", "Marge H"],
                    ["gapX", "Espace X"],
                    ["gapY", "Espace Y"],
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      value={custom[k]}
                      onChange={(e) => setCustom((c) => ({ ...c, [k]: Math.max(0, Number(e.target.value) || 0) }))}
                    />
                  </Field>
                ))}
              </div>
            )}
            {isSheet && (
              <Field label="Première position libre sur la planche" hint="Réutilisez une planche entamée : les positions précédentes sont laissées vides.">
                <Input type="number" min={1} max={perPage} value={startPosition + 1} onChange={(e) => setStartPosition(Math.min(perPage - 1, Math.max(0, (Number(e.target.value) || 1) - 1)))} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  [showCompany, setShowCompany, "Nom de la société"],
                  [showTitle, setShowTitle, "Désignation"],
                  [showSubtitle, setShowSubtitle, "Localisation"],
                  [drawBorders, setDrawBorders, "Traits de coupe"],
                ] as const
              ).map(([value, setter, label]) => (
                <label key={label} className="flex items-center gap-2">
                  <Checkbox checked={value} onCheckedChange={(v) => setter(v === true)} /> {label}
                </label>
              ))}
            </div>
            {templateError && <p className="text-sm font-medium text-destructive">{templateError}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={generate} disabled={pending || !items.length || !!templateError}>
                {pending ? <Loader2 className="animate-spin" /> : <Printer />} Générer le PDF & imprimer
              </Button>
              {tab === "assets" && (
                <Button variant="outline" onClick={confirmAffixed} disabled={pending || !items.length}>
                  <CheckCheck /> Confirmer la pose
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aperçu {isSheet ? "de la première planche" : "des étiquettes"}</CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Sélectionnez des éléments pour prévisualiser.</p>
            ) : (
              <SheetPreview template={previewTemplate} items={isSheet ? previewItems : items.slice(0, 4)} startPosition={isSheet ? startPosition : 0} companyName={companyName} showCompany={showCompany} showTitle={showTitle} showSubtitle={showSubtitle} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SheetPreview({
  template: t,
  items,
  startPosition,
  companyName,
  showCompany,
  showTitle,
  showSubtitle,
}: {
  template: LabelTemplate;
  items: LabelItem[];
  startPosition: number;
  companyName: string;
  showCompany: boolean;
  showTitle: boolean;
  showSubtitle: boolean;
}) {
  const pageH = t.kind === "thermal" ? t.labelHeight : t.pageHeight;
  return (
    <div className="mx-auto w-full overflow-hidden rounded-md border bg-white shadow-inner" style={{ aspectRatio: `${t.pageWidth} / ${pageH}`, containerType: "inline-size" }}>
      <div className="relative h-full w-full">
        {items.map((item, i) => {
          const { x, y } = labelSlotPosition(t, i + startPosition);
          const vertical = t.labelWidth / t.labelHeight < 1.45;
          // 1 mm expressed in container-query units so that the preview scales with the card.
          const mm = (v: number) => `${(v / t.pageWidth) * 100}cqw`;
          const pad = Math.max(1.2, Math.min(t.labelWidth, t.labelHeight) * 0.06);
          const textWidth = vertical ? t.labelWidth - 2 * pad : t.labelWidth - t.labelHeight - pad;
          // Same rule as the PDF engine: monospace code shrinks to fit the text column.
          const codeSize = Math.min(t.labelHeight * 0.14, textWidth / (Math.max(item.code.length, 1) * 0.62));
          return (
            <div
              key={item.id}
              className="absolute flex overflow-hidden rounded-[2px] border border-dashed border-slate-300 text-black"
              style={{ left: mm(x), top: mm(y), width: mm(t.labelWidth), height: mm(t.labelHeight), padding: mm(pad), gap: mm(1.2), flexDirection: vertical ? "column" : "row", alignItems: vertical ? "center" : "stretch" }}
            >
              <QRCodeSVG value={item.qrPayload} level="M" marginSize={0} style={{ height: vertical ? "62%" : "100%", width: "auto", aspectRatio: "1", flexShrink: 0 }} />
              <div className="min-w-0 leading-tight" style={{ fontSize: mm(Math.min(3, t.labelHeight * 0.1)) }}>
                {showCompany && !vertical && <div className="truncate font-bold uppercase">{companyName}</div>}
                <div className="whitespace-nowrap font-mono font-bold" style={{ fontSize: mm(codeSize) }}>
                  {item.code}
                </div>
                {showTitle && !vertical && <div className="line-clamp-2">{item.title}</div>}
                {showSubtitle && !vertical && item.subtitle && <div className="truncate text-slate-500">{item.subtitle}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
