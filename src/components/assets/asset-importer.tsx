"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { importAssets, type ImportReport } from "@/actions/assets";
import type { ImportRowInput } from "@/lib/validators";
import { writeWorkbook } from "@/lib/exports/xlsx-helpers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";

const COLUMNS: { key: keyof ImportRowInput; header: string; required?: boolean }[] = [
  { key: "code", header: "Code" },
  { key: "designation", header: "Désignation", required: true },
  { key: "categoryCode", header: "Code catégorie", required: true },
  { key: "brand", header: "Marque" },
  { key: "model", header: "Modèle" },
  { key: "serialNumber", header: "N° de série" },
  { key: "quantity", header: "Quantité" },
  { key: "acquisitionDate", header: "Date acquisition", required: true },
  { key: "commissioningDate", header: "Date mise en service" },
  { key: "acquisitionValue", header: "Valeur brute HT", required: true },
  { key: "depreciationMethod", header: "Méthode" },
  { key: "usefulLifeYears", header: "Durée (ans)" },
  { key: "locationCode", header: "Code localisation" },
  { key: "costCenterCode", header: "Code centre de coût" },
  { key: "custodianMatricule", header: "Matricule détenteur" },
  { key: "supplierName", header: "Fournisseur" },
  { key: "status", header: "Statut" },
  { key: "notes", header: "Notes" },
];

const normalizeHeader = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const HEADER_MAP = new Map(COLUMNS.map((c) => [normalizeHeader(c.header), c.key]));

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return s;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function normalizeMethod(v: unknown): ImportRowInput["depreciationMethod"] {
  const s = normalizeHeader(String(v ?? ""));
  if (!s) return null;
  if (s.startsWith("lin")) return "LINEAR";
  if (s.startsWith("deg") || s.startsWith("dec")) return "DECLINING";
  if (s.startsWith("non") || s === "none") return "NONE";
  return null;
}

function normalizeStatus(v: unknown): ImportRowInput["status"] {
  const s = normalizeHeader(String(v ?? ""));
  if (!s) return null;
  if (s.includes("service")) return "IN_SERVICE";
  if (s.includes("stock")) return "IN_STOCK";
  if (s.includes("maint") || s.includes("panne")) return "UNDER_MAINTENANCE";
  if (s.includes("disparu") || s.includes("missing")) return "MISSING";
  return null;
}

export function AssetImporter({
  referentials,
}: {
  referentials: { categories: { code: string; name: string }[]; locations: { code: string; path: string }[]; costCenters: { code: string; name: string }[]; employees: { matricule: string; name: string }[] };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRowInput[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();

  const downloadTemplate = () =>
    writeWorkbook(
      [
        {
          name: "Immobilisations",
          header: COLUMNS.map((c) => (c.required ? `${c.header} *` : c.header)),
          rows: [
            [
              "",
              "Ordinateur portable 14 pouces",
              referentials.categories[0]?.code ?? "INFO",
              "Lenovo",
              "ThinkPad T14",
              "PF3ABC12",
              1,
              "2024-03-15",
              "2024-03-20",
              14500,
              "Linéaire",
              5,
              referentials.locations[0]?.code ?? "",
              referentials.costCenters[0]?.code ?? "",
              referentials.employees[0]?.matricule ?? "",
              "Fournisseur SARL",
              "En service",
              "",
            ],
          ],
          widths: COLUMNS.map((c) => Math.max(14, c.header.length + 4)),
        },
        {
          name: "Référentiels",
          header: ["Code catégorie", "Catégorie", "", "Code localisation", "Localisation", "", "Centre de coût", "Libellé", "", "Matricule", "Collaborateur"],
          rows: Array.from({ length: Math.max(referentials.categories.length, referentials.locations.length, referentials.costCenters.length, referentials.employees.length) }, (_, i) => [
            referentials.categories[i]?.code,
            referentials.categories[i]?.name,
            "",
            referentials.locations[i]?.code,
            referentials.locations[i]?.path,
            "",
            referentials.costCenters[i]?.code,
            referentials.costCenters[i]?.name,
            "",
            referentials.employees[i]?.matricule,
            referentials.employees[i]?.name,
          ]),
          widths: [16, 30, 2, 22, 60, 2, 16, 28, 2, 14, 30],
        },
      ],
      "Modele_import_immobilisations.xlsx",
    );

  const parse = async (file: File) => {
    setParseError(null);
    setReport(null);
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      const headerIndex = matrix.findIndex((r) => r.some((c) => HEADER_MAP.has(normalizeHeader(String(c).replace("*", "")))));
      if (headerIndex < 0) throw new Error("Ligne d'en-tête introuvable : utilisez le modèle fourni.");
      const headers = matrix[headerIndex].map((h) => HEADER_MAP.get(normalizeHeader(String(h).replace("*", ""))));
      const parsed: ImportRowInput[] = [];
      matrix.slice(headerIndex + 1).forEach((line, i) => {
        if (!line.some((c) => String(c ?? "").trim() !== "")) return;
        const rec: Record<string, unknown> = {};
        headers.forEach((key, col) => {
          if (key) rec[key] = line[col];
        });
        parsed.push({
          rowNumber: headerIndex + i + 2,
          code: String(rec.code ?? "").trim() || null,
          designation: String(rec.designation ?? "").trim(),
          categoryCode: String(rec.categoryCode ?? "").trim(),
          brand: String(rec.brand ?? "").trim() || null,
          model: String(rec.model ?? "").trim() || null,
          serialNumber: String(rec.serialNumber ?? "").trim() || null,
          quantity: toNumber(rec.quantity) ?? 1,
          acquisitionDate: toIsoDate(rec.acquisitionDate) ?? "",
          commissioningDate: toIsoDate(rec.commissioningDate),
          acquisitionValue: toNumber(rec.acquisitionValue) ?? Number.NaN,
          depreciationMethod: normalizeMethod(rec.depreciationMethod),
          usefulLifeYears: toNumber(rec.usefulLifeYears) ?? null,
          locationCode: String(rec.locationCode ?? "").trim() || null,
          costCenterCode: String(rec.costCenterCode ?? "").trim() || null,
          custodianMatricule: String(rec.custodianMatricule ?? "").trim() || null,
          supplierName: String(rec.supplierName ?? "").trim() || null,
          status: normalizeStatus(rec.status),
          notes: String(rec.notes ?? "").trim() || null,
        });
      });
      if (!parsed.length) throw new Error("Aucune ligne de données.");
      setRows(parsed);
    } catch (e) {
      setRows([]);
      setParseError(e instanceof Error ? e.message : "Fichier illisible.");
    }
  };

  const submit = () =>
    start(async () => {
      const res = await importAssets(rows);
      if (!res.ok) return void toast.error(res.error);
      setReport(res.data);
      if (res.data.created) {
        toast.success(`${res.data.created} immobilisation(s) importée(s).`);
        setRows([]);
        router.refresh();
      } else toast.error(`${res.data.errors.length} erreur(s) : aucun bien importé.`);
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Préparer le fichier</CardTitle>
          <CardDescription>
            Téléchargez le modèle Excel : il contient les colonnes attendues et, en second onglet, les codes de vos catégories, localisations, centres de coût et
            matricules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download /> Télécharger le modèle
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Charger et contrôler</CardTitle>
          <CardDescription>Formats acceptés : .xlsx, .xls, .csv. L&apos;import est transactionnel : en cas d&apos;erreur, aucune ligne n&apos;est créée.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => inputRef.current?.click()}>
              <Upload /> Choisir un fichier
            </Button>
            {fileName && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" /> {fileName} — {formatNumber(rows.length)} ligne(s)
              </span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void parse(f);
                e.target.value = "";
              }}
            />
          </div>
          {parseError && (
            <Alert variant="destructive">
              <XCircle />
              <AlertDescription className="text-destructive">{parseError}</AlertDescription>
            </Alert>
          )}
          {rows.length > 0 && (
            <>
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ligne</TableHead>
                      <TableHead>Désignation</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Acquisition</TableHead>
                      <TableHead className="text-right">Valeur</TableHead>
                      <TableHead>Localisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 200).map((r) => (
                      <TableRow key={r.rowNumber}>
                        <TableCell className="tabular">{r.rowNumber}</TableCell>
                        <TableCell>{r.designation || <span className="text-destructive">manquante</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{r.categoryCode || <span className="text-destructive">—</span>}</TableCell>
                        <TableCell className="tabular">{r.acquisitionDate || <span className="text-destructive">—</span>}</TableCell>
                        <TableCell className="text-right tabular">{Number.isFinite(r.acquisitionValue) ? formatNumber(Number(r.acquisitionValue), 2) : <span className="text-destructive">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">{r.locationCode ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={submit} disabled={pending} size="lg">
                {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Contrôler et importer {formatNumber(rows.length)} ligne(s)
              </Button>
            </>
          )}
          {report && report.errors.length > 0 && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>Import refusé — {report.errors.length} erreur(s)</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 max-h-60 list-disc space-y-0.5 overflow-auto pl-4">
                  {report.errors.map((e, i) => (
                    <li key={i}>
                      Ligne {e.rowNumber} : {e.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {report && report.created > 0 && (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>{report.created} immobilisation(s) importée(s)</AlertTitle>
              <AlertDescription>Les fiches sont tracées dans l&apos;historique (événement « Création — import »). Pensez à imprimer leurs étiquettes QR.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
