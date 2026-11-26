/**
 * Invoice extraction post-processing — pure & client-safe.
 *
 * Gemini's structured output is already constrained by a JSON schema, but LLM
 * output must never be trusted blindly in an accounting workflow. This module:
 *   - re-validates the payload with Zod (lenient input → strict output),
 *   - normalises French / Moroccan number & date formats,
 *   - derives missing amounts (unit price ↔ line total, HT / TVA / TTC),
 *   - flags lines below the capitalisation threshold,
 *   - runs arithmetic consistency checks (Σ lignes = HT, HT + TVA = TTC, …).
 * It is shared by the server extractor and the split-screen review UI so the
 * user sees the exact same checks re-computed live while editing.
 */
import { z } from "zod";

export const NON_ASSET_CODE = "NON_IMMOBILISABLE";

export const DOCUMENT_TYPES = ["INVOICE", "PROFORMA", "CREDIT_NOTE", "DELIVERY_NOTE", "RECEIPT", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  INVOICE: "Facture",
  PROFORMA: "Facture proforma / Devis",
  CREDIT_NOTE: "Avoir",
  DELIVERY_NOTE: "Bon de livraison",
  RECEIPT: "Ticket / Reçu",
  OTHER: "Autre document",
};

const STANDARD_VAT_RATES = [20, 14, 10, 7, 0];

export interface ExtractedSupplier {
  name: string | null;
  ice: string | null;
  taxId: string | null;
  tradeRegister: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

export interface ExtractedInvoiceHeader {
  number: string | null;
  date: string | null; // YYYY-MM-DD
  dueDate: string | null;
  currency: string;
  totalHT: number | null;
  totalVAT: number | null;
  totalTTC: number | null;
}

export interface ExtractedLine {
  lineNo: number;
  designation: string;
  specifications: string | null;
  brand: string | null;
  model: string | null;
  serialNumbers: string[];
  quantity: number;
  unitPriceHT: number;
  vatRate: number;
  totalHT: number;
  isFixedAsset: boolean;
  categoryCode: string | null;
  classificationRationale: string | null;
  confidence: number;
  belowThreshold: boolean;
  warnings: string[];
}

export interface ExtractedInvoice {
  documentType: DocumentType;
  supplier: ExtractedSupplier;
  invoice: ExtractedInvoiceHeader;
  lines: ExtractedLine[];
  warnings: string[];
  overallConfidence: number;
}

export interface ConsistencyCheck {
  key: "lines_vs_total_ht" | "ht_vat_ttc" | "vat_by_line" | "line_arithmetic";
  label: string;
  ok: boolean;
  expected: number | null;
  actual: number | null;
  delta: number | null;
  detail?: string;
}

export interface NormalizationContext {
  categoryCodes: string[];
  capitalizationThreshold?: number;
  defaultCurrency?: string;
}

// ---------------------------------------------------------------------------
// Scalar parsers
// ---------------------------------------------------------------------------

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Parses "1 234,56", "1.234,56", "1,234.56", "(120,00)", "15 000 DH"… */
export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value
    .trim()
    .replace(/[\s   ']/g, "")
    .replace(/(MAD|DHS?|DIRHAMS?|EUR|USD|€|\$|%)/gi, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()+-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const parts = s.split(",");
    s = parts.length === 2 ? parts.join(".") : parts.join("");
  } else if (lastDot > -1) {
    const parts = s.split(".");
    if (parts.length > 2) s = parts.join("");
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Accepts ISO (2026-03-15) and European (15/03/2026, 15.03.26) formats. */
export function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return validYmd(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

export function normalizeCurrency(value: unknown, fallback = "MAD"): string {
  if (typeof value !== "string") return fallback;
  const s = value.trim().toUpperCase().replace(/\./g, "");
  if (!s) return fallback;
  if (["DH", "DHS", "DIRHAM", "DIRHAMS", "MAD"].includes(s)) return "MAD";
  if (["€", "EURO", "EUROS", "EUR"].includes(s)) return "EUR";
  if (["$", "US$", "USD", "DOLLAR", "DOLLARS"].includes(s)) return "USD";
  return /^[A-Z]{3}$/.test(s) ? s : fallback;
}

export function normalizeIce(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length ? digits : null;
}

function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  if (!s || /^(null|n\/a|na|none|-|—)$/i.test(s)) return null;
  return s.slice(0, max);
}

function splitSerials(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    for (const part of v.split(/[;,\n]/)) {
      const cleaned = part.replace(/^(S\/?N|N°\s*de\s*série|SERIAL|IMEI)\s*[:#-]?\s*/i, "").trim();
      if (cleaned.length >= 3 && cleaned.length <= 120) out.add(cleaned);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Lenient raw schema (what the model may return)
// ---------------------------------------------------------------------------

const looseNumber = z.union([z.number(), z.string()]).nullish();
const looseString = z.string().nullish();

const rawLineSchema = z
  .object({
    designation: looseString,
    specifications: looseString,
    brand: looseString,
    model: looseString,
    serialNumbers: z.array(z.string()).nullish(),
    quantity: looseNumber,
    unitPriceHT: looseNumber,
    vatRate: looseNumber,
    totalHT: looseNumber,
    isFixedAsset: z.boolean().nullish(),
    assetCategoryCode: looseString,
    classificationRationale: looseString,
    confidence: looseNumber,
  })
  .passthrough();

const rawInvoiceSchema = z
  .object({
    documentType: looseString,
    supplier: z
      .object({
        name: looseString,
        ice: looseString,
        taxId: looseString,
        tradeRegister: looseString,
        address: looseString,
        email: looseString,
        phone: looseString,
      })
      .partial()
      .nullish(),
    invoice: z
      .object({
        number: looseString,
        date: looseString,
        dueDate: looseString,
        currency: looseString,
        totalHT: looseNumber,
        totalVAT: looseNumber,
        totalTTC: looseNumber,
      })
      .partial()
      .nullish(),
    lines: z.array(rawLineSchema).nullish(),
    warnings: z.array(z.string()).nullish(),
    overallConfidence: looseNumber,
  })
  .passthrough();

export class ExtractionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionSchemaError";
  }
}

function clamp01(v: number | null, fallback: number): number {
  if (v === null || Number.isNaN(v)) return fallback;
  const n = v > 1 && v <= 100 ? v / 100 : v;
  return Math.min(1, Math.max(0, n));
}

function normalizeVatRate(value: unknown): number | null {
  const n = parseLocaleNumber(value);
  if (n === null || n < 0) return null;
  if (n > 0 && n < 1) return round2(n * 100);
  return n <= 100 ? round2(n) : null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function normalizeExtraction(raw: unknown, ctx: NormalizationContext): ExtractedInvoice {
  const parsed = rawInvoiceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExtractionSchemaError(`Structure JSON inattendue : ${parsed.error.issues[0]?.message ?? "invalide"}`);
  }
  const r = parsed.data;
  const warnings: string[] = (r.warnings ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 30);
  const codes = new Set(ctx.categoryCodes.map((c) => c.toUpperCase()));
  const threshold = ctx.capitalizationThreshold ?? 0;
  const defaultCurrency = ctx.defaultCurrency ?? "MAD";

  const documentType: DocumentType = DOCUMENT_TYPES.includes((r.documentType ?? "").toUpperCase() as DocumentType)
    ? ((r.documentType ?? "").toUpperCase() as DocumentType)
    : "OTHER";
  if (documentType !== "INVOICE") {
    warnings.push(`Le document semble être : ${DOCUMENT_TYPE_LABELS[documentType]}. Vérifiez avant de générer des immobilisations.`);
  }

  const supplierRaw = r.supplier ?? {};
  const ice = normalizeIce(supplierRaw.ice);
  if (ice && ice.length !== 15) warnings.push(`ICE fournisseur « ${ice} » : 15 chiffres attendus.`);
  const supplier: ExtractedSupplier = {
    name: cleanText(supplierRaw.name, 200),
    ice,
    taxId: cleanText(supplierRaw.taxId, 40),
    tradeRegister: cleanText(supplierRaw.tradeRegister, 40),
    address: cleanText(supplierRaw.address, 300),
    email: cleanText(supplierRaw.email, 160),
    phone: cleanText(supplierRaw.phone, 40),
  };
  if (!supplier.name) warnings.push("Nom du fournisseur non détecté.");

  const inv = r.invoice ?? {};
  let totalHT = parseLocaleNumber(inv.totalHT);
  let totalVAT = parseLocaleNumber(inv.totalVAT);
  let totalTTC = parseLocaleNumber(inv.totalTTC);
  const date = normalizeIsoDate(inv.date);
  if (!date) warnings.push("Date de facture non détectée ou illisible.");
  const number = cleanText(inv.number, 80);
  if (!number) warnings.push("Numéro de facture non détecté.");

  // Header VAT rate, used to fill lines without an explicit rate.
  let headerVatRate: number | null = null;
  if (totalHT && totalHT > 0 && totalVAT !== null) {
    const rate = round2((totalVAT / totalHT) * 100);
    const standard = STANDARD_VAT_RATES.find((s) => Math.abs(s - rate) < 0.15);
    if (standard !== undefined) headerVatRate = standard;
  }

  const lines: ExtractedLine[] = [];
  (r.lines ?? []).forEach((l, index) => {
    const designation = cleanText(l.designation, 300);
    if (!designation) return;
    const lineWarnings: string[] = [];
    const qtyRaw = parseLocaleNumber(l.quantity);
    const quantity = qtyRaw !== null && qtyRaw > 0 ? qtyRaw : 1;
    if (qtyRaw === null || qtyRaw <= 0) lineWarnings.push("Quantité absente : 1 retenue par défaut.");

    let unit = parseLocaleNumber(l.unitPriceHT);
    let total = parseLocaleNumber(l.totalHT);
    if (unit !== null && unit < 0) unit = Math.abs(unit);
    if (total !== null && total < 0) total = Math.abs(total);
    if (unit === null && total !== null) {
      unit = round2(total / quantity);
      lineWarnings.push("Prix unitaire déduit du total de la ligne.");
    }
    if (total === null && unit !== null) total = round2(unit * quantity);
    if (unit === null || total === null) {
      unit = unit ?? 0;
      total = total ?? 0;
      lineWarnings.push("Montant de la ligne introuvable.");
    }

    let vatRate = normalizeVatRate(l.vatRate);
    if (vatRate === null) {
      vatRate = headerVatRate ?? 20;
      lineWarnings.push(`Taux de TVA non lu : ${vatRate} % appliqué.`);
    }

    const rawCode = (l.assetCategoryCode ?? "").trim().toUpperCase();
    const nonAsset = rawCode === NON_ASSET_CODE;
    const categoryCode = !nonAsset && codes.has(rawCode) ? rawCode : null;
    const isFixedAsset = Boolean(l.isFixedAsset) && !nonAsset;
    if (isFixedAsset && !categoryCode) lineWarnings.push("Catégorie comptable à préciser.");

    const serialNumbers = splitSerials(l.serialNumbers);
    if (serialNumbers.length > quantity) {
      lineWarnings.push(`${serialNumbers.length} numéros de série pour une quantité de ${quantity}.`);
    }
    const belowThreshold = isFixedAsset && threshold > 0 && unit < threshold;
    if (belowThreshold) lineWarnings.push("Valeur unitaire sous le seuil d'immobilisation.");

    lines.push({
      lineNo: lines.length + 1,
      designation,
      specifications: cleanText(l.specifications, 2000),
      brand: cleanText(l.brand, 80),
      model: cleanText(l.model, 120),
      serialNumbers,
      quantity,
      unitPriceHT: round2(unit),
      vatRate,
      totalHT: round2(total),
      isFixedAsset,
      categoryCode,
      classificationRationale: cleanText(l.classificationRationale, 500),
      confidence: clamp01(parseLocaleNumber(l.confidence), 0.5),
      belowThreshold,
      warnings: lineWarnings,
    });
    void index;
  });

  if (lines.length === 0) warnings.push("Aucune ligne de détail exploitable n'a été détectée.");

  const linesHT = round2(lines.reduce((acc, l) => acc + l.totalHT, 0));
  if (totalHT === null && lines.length) {
    totalHT = linesHT;
    warnings.push("Total HT absent : somme des lignes retenue.");
  }
  if (totalVAT === null && totalHT !== null && totalTTC !== null) totalVAT = round2(totalTTC - totalHT);
  if (totalVAT === null && lines.length) {
    totalVAT = round2(lines.reduce((acc, l) => acc + (l.totalHT * l.vatRate) / 100, 0));
  }
  if (totalTTC === null && totalHT !== null && totalVAT !== null) totalTTC = round2(totalHT + totalVAT);

  return {
    documentType,
    supplier,
    invoice: {
      number,
      date,
      dueDate: normalizeIsoDate(inv.dueDate),
      currency: normalizeCurrency(inv.currency, defaultCurrency),
      totalHT: totalHT === null ? null : round2(totalHT),
      totalVAT: totalVAT === null ? null : round2(totalVAT),
      totalTTC: totalTTC === null ? null : round2(totalTTC),
    },
    lines,
    warnings,
    overallConfidence: clamp01(parseLocaleNumber(r.overallConfidence), 0.5),
  };
}

// ---------------------------------------------------------------------------
// Consistency checks
// ---------------------------------------------------------------------------

export interface ConsistencyInput {
  totalHT: number | null;
  totalVAT: number | null;
  totalTTC: number | null;
  lines: { quantity: number; unitPriceHT: number; totalHT?: number | null; vatRate: number }[];
}

function tolerance(reference: number, ratio: number, min: number): number {
  return Math.max(min, Math.abs(reference) * ratio);
}

export function checkConsistency(input: ConsistencyInput): ConsistencyCheck[] {
  const checks: ConsistencyCheck[] = [];
  const lineTotal = (l: ConsistencyInput["lines"][number]) =>
    l.totalHT === null || l.totalHT === undefined ? round2(l.quantity * l.unitPriceHT) : l.totalHT;
  const sumLines = round2(input.lines.reduce((acc, l) => acc + lineTotal(l), 0));

  if (input.totalHT !== null) {
    const delta = round2(sumLines - input.totalHT);
    checks.push({
      key: "lines_vs_total_ht",
      label: "Somme des lignes = Total HT",
      ok: Math.abs(delta) <= tolerance(input.totalHT, 0.005, 1),
      expected: input.totalHT,
      actual: sumLines,
      delta,
      detail: Math.abs(delta) > 1 ? "Écart possible : remise globale, frais ou ligne non détectée." : undefined,
    });
  }
  if (input.totalHT !== null && input.totalVAT !== null && input.totalTTC !== null) {
    const computed = round2(input.totalHT + input.totalVAT);
    const delta = round2(computed - input.totalTTC);
    checks.push({
      key: "ht_vat_ttc",
      label: "Total HT + TVA = Total TTC",
      ok: Math.abs(delta) <= tolerance(input.totalTTC, 0.002, 1),
      expected: input.totalTTC,
      actual: computed,
      delta,
    });
  }
  if (input.totalVAT !== null && input.lines.length) {
    const vat = round2(input.lines.reduce((acc, l) => acc + (lineTotal(l) * l.vatRate) / 100, 0));
    const delta = round2(vat - input.totalVAT);
    checks.push({
      key: "vat_by_line",
      label: "TVA recalculée par ligne = Total TVA",
      ok: Math.abs(delta) <= tolerance(input.totalVAT, 0.01, 1),
      expected: input.totalVAT,
      actual: vat,
      delta,
    });
  }
  if (input.lines.length) {
    const failing = input.lines.filter((l) => {
      if (l.totalHT === null || l.totalHT === undefined) return false;
      const computed = round2(l.quantity * l.unitPriceHT);
      return Math.abs(computed - l.totalHT) > tolerance(l.totalHT, 0.005, 0.05);
    }).length;
    checks.push({
      key: "line_arithmetic",
      label: "Quantité × Prix unitaire = Montant ligne",
      ok: failing === 0,
      expected: input.lines.length,
      actual: input.lines.length - failing,
      delta: failing,
      detail: failing ? `${failing} ligne(s) incohérente(s) (remise ligne ?)` : undefined,
    });
  }
  return checks;
}
