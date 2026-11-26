/**
 * Accounting reconciliation engine (Rapprochement physico-comptable) — pure.
 *
 * Inputs: the theoretical register frozen at campaign launch (snapshot), every
 * physical scan of the campaign, assets scanned that were not part of the
 * snapshot, and the surplus items captured in the field.
 *
 * Output: one classified line per asset / surplus in four categories:
 *   1. MATCH      — found in the expected location, consistent status
 *   2. MISPLACED  — found, but in another location (or with a status to regularise)
 *   3. MISSING    — in the register, never scanned during the campaign
 *   4. SURPLUS    — found physically, absent from the register
 */
import type {
  AssetConditionValue,
  AssetStatusValue,
  ReconciliationCategoryValue,
  SurplusStatusValue,
} from "@/lib/domain";

export interface SnapshotEntry {
  id: string;
  assetId: string;
  assetCode: string;
  designation: string;
  serialNumber: string | null;
  categoryName: string;
  expectedLocationId: string | null;
  expectedLocationPath: string | null;
  expectedStatus: AssetStatusValue;
  grossValue: number;
  netBookValue: number;
}

export interface ScanEntry {
  id: string;
  assetId: string;
  locationId: string;
  condition: AssetConditionValue;
  scannedAt: Date;
  transferProposed: boolean;
}

/** An asset scanned during the campaign but absent from the snapshot. */
export interface ExtraAssetEntry {
  assetId: string;
  assetCode: string;
  designation: string;
  serialNumber: string | null;
  categoryName: string;
  status: AssetStatusValue;
  locationId: string | null;
  locationPath: string | null;
  grossValue: number;
  netBookValue: number;
}

export interface SurplusEntry {
  id: string;
  tempTag: string;
  designation: string;
  serialNumber: string | null;
  categoryName: string | null;
  locationId: string;
  condition: AssetConditionValue;
  estimatedValue: number;
  status: SurplusStatusValue;
  scannedCode: string | null;
}

export interface ClassifiedLine {
  key: string; // stable key used to carry resolutions across re-runs
  category: ReconciliationCategoryValue;
  assetId: string | null;
  snapshotItemId: string | null;
  scanId: string | null;
  surplusId: string | null;
  assetCode: string;
  designation: string;
  categoryName: string | null;
  serialNumber: string | null;
  expectedLocationId: string | null;
  expectedLocationPath: string | null;
  foundLocationId: string | null;
  foundLocationPath: string | null;
  expectedStatus: AssetStatusValue | null;
  condition: AssetConditionValue | null;
  grossValue: number;
  netBookValue: number;
  reasons: string[];
}

export interface ReconciliationInput {
  snapshot: SnapshotEntry[];
  scans: ScanEntry[];
  extraAssets: ExtraAssetEntry[];
  surpluses: SurplusEntry[];
  locationPaths: Map<string, string>;
}

export function latestScanByAsset(scans: ScanEntry[]): Map<string, ScanEntry> {
  const map = new Map<string, ScanEntry>();
  for (const scan of scans) {
    const current = map.get(scan.assetId);
    if (!current || scan.scannedAt.getTime() >= current.scannedAt.getTime()) map.set(scan.assetId, scan);
  }
  return map;
}

function conditionReason(condition: AssetConditionValue): string | null {
  if (condition === "DAMAGED") return "État constaté : endommagé";
  if (condition === "TO_REPAIR") return "État constaté : à réparer";
  return null;
}

export function classifyReconciliation(input: ReconciliationInput): ClassifiedLine[] {
  const { snapshot, scans, extraAssets, surpluses, locationPaths } = input;
  const latest = latestScanByAsset(scans);
  const scanCounts = new Map<string, number>();
  for (const s of scans) scanCounts.set(s.assetId, (scanCounts.get(s.assetId) ?? 0) + 1);
  const pathOf = (id: string | null) => (id ? locationPaths.get(id) ?? null : null);
  const lines: ClassifiedLine[] = [];
  const snapshotAssetIds = new Set<string>();

  for (const item of snapshot) {
    snapshotAssetIds.add(item.assetId);
    const scan = latest.get(item.assetId);
    const base = {
      key: `asset:${item.assetId}`,
      assetId: item.assetId,
      snapshotItemId: item.id,
      surplusId: null,
      assetCode: item.assetCode,
      designation: item.designation,
      categoryName: item.categoryName,
      serialNumber: item.serialNumber,
      expectedLocationId: item.expectedLocationId,
      expectedLocationPath: item.expectedLocationPath,
      expectedStatus: item.expectedStatus,
      grossValue: item.grossValue,
      netBookValue: item.netBookValue,
    };

    if (!scan) {
      const reasons = ["Non scanné durant la campagne"];
      if (item.expectedStatus === "MISSING") reasons.push("Déjà déclaré disparu dans le fichier comptable");
      if (item.expectedStatus === "UNDER_MAINTENANCE") reasons.push("Bien déclaré en maintenance (vérifier s'il est chez un prestataire)");
      lines.push({ ...base, category: "MISSING", scanId: null, foundLocationId: null, foundLocationPath: null, condition: null, reasons });
      continue;
    }

    const reasons: string[] = [];
    const count = scanCounts.get(item.assetId) ?? 1;
    if (count > 1) reasons.push(`Scanné ${count} fois`);
    const cond = conditionReason(scan.condition);
    const foundPath = pathOf(scan.locationId);
    let category: ReconciliationCategoryValue = "MATCH";

    if (item.expectedLocationId !== scan.locationId) {
      category = "MISPLACED";
      reasons.unshift(
        item.expectedLocationId
          ? "Localisation physique différente de la localisation comptable"
          : "Aucune localisation dans le fichier comptable",
      );
      if (scan.transferProposed) reasons.push("Transfert proposé par l'inventoriste");
    }
    if (item.expectedStatus === "MISSING") {
      category = "MISPLACED";
      reasons.push("Bien déclaré disparu retrouvé — statut à régulariser");
    }
    if (cond) reasons.push(cond);

    lines.push({
      ...base,
      category,
      scanId: scan.id,
      foundLocationId: scan.locationId,
      foundLocationPath: foundPath,
      condition: scan.condition,
      reasons,
    });
  }

  for (const extra of extraAssets) {
    if (snapshotAssetIds.has(extra.assetId)) continue;
    const scan = latest.get(extra.assetId);
    if (!scan) continue;
    const disposed = extra.status === "DISPOSED";
    const reasons = disposed
      ? ["Bien sorti de l'actif (rebut / cession) retrouvé physiquement"]
      : [`Hors périmètre de la campagne — localisation comptable : ${extra.locationPath ?? "non renseignée"}`];
    const cond = conditionReason(scan.condition);
    if (cond) reasons.push(cond);
    lines.push({
      key: `asset:${extra.assetId}`,
      category: disposed ? "SURPLUS" : "MISPLACED",
      assetId: extra.assetId,
      snapshotItemId: null,
      scanId: scan.id,
      surplusId: null,
      assetCode: extra.assetCode,
      designation: extra.designation,
      categoryName: extra.categoryName,
      serialNumber: extra.serialNumber,
      expectedLocationId: extra.locationId,
      expectedLocationPath: extra.locationPath,
      foundLocationId: scan.locationId,
      foundLocationPath: pathOf(scan.locationId),
      expectedStatus: extra.status,
      condition: scan.condition,
      grossValue: extra.grossValue,
      netBookValue: disposed ? 0 : extra.netBookValue,
      reasons,
    });
  }

  for (const surplus of surpluses) {
    const reasons = ["Bien trouvé physiquement, absent du fichier comptable"];
    if (surplus.scannedCode) reasons.push(`Code lu sur site : ${surplus.scannedCode}`);
    else reasons.push("Bien non étiqueté");
    const cond = conditionReason(surplus.condition);
    if (cond) reasons.push(cond);
    lines.push({
      key: `surplus:${surplus.id}`,
      category: "SURPLUS",
      assetId: null,
      snapshotItemId: null,
      scanId: null,
      surplusId: surplus.id,
      assetCode: surplus.tempTag,
      designation: surplus.designation,
      categoryName: surplus.categoryName,
      serialNumber: surplus.serialNumber,
      expectedLocationId: null,
      expectedLocationPath: null,
      foundLocationId: surplus.locationId,
      foundLocationPath: pathOf(surplus.locationId),
      expectedStatus: null,
      condition: surplus.condition,
      grossValue: surplus.estimatedValue,
      netBookValue: surplus.estimatedValue,
      reasons,
    });
  }

  const order: Record<ReconciliationCategoryValue, number> = { MISSING: 0, MISPLACED: 1, SURPLUS: 2, MATCH: 3 };
  return lines.sort((a, b) => order[a.category] - order[b.category] || a.assetCode.localeCompare(b.assetCode));
}

export interface CategoryTotals {
  count: number;
  grossValue: number;
  netBookValue: number;
}

export interface ReconciliationSummary {
  byCategory: Record<ReconciliationCategoryValue, CategoryTotals>;
  theoreticalCount: number;
  foundCount: number;
  /** Assets of the theoretical register physically found (match + misplaced) / register size. */
  physicalRate: number;
  /** Perfect matches / register size. */
  conformityRate: number;
}

export function summarizeReconciliation(
  lines: Pick<ClassifiedLine, "category" | "grossValue" | "netBookValue" | "snapshotItemId">[],
): ReconciliationSummary {
  const empty = (): CategoryTotals => ({ count: 0, grossValue: 0, netBookValue: 0 });
  const byCategory: Record<ReconciliationCategoryValue, CategoryTotals> = {
    MATCH: empty(),
    MISPLACED: empty(),
    MISSING: empty(),
    SURPLUS: empty(),
  };
  let theoretical = 0;
  let found = 0;
  let matched = 0;
  for (const line of lines) {
    const bucket = byCategory[line.category];
    bucket.count += 1;
    bucket.grossValue = Math.round((bucket.grossValue + line.grossValue) * 100) / 100;
    bucket.netBookValue = Math.round((bucket.netBookValue + line.netBookValue) * 100) / 100;
    if (line.snapshotItemId) {
      theoretical += 1;
      if (line.category !== "MISSING") found += 1;
      if (line.category === "MATCH") matched += 1;
    }
  }
  return {
    byCategory,
    theoreticalCount: theoretical,
    foundCount: found,
    physicalRate: theoretical ? found / theoretical : 0,
    conformityRate: theoretical ? matched / theoretical : 0,
  };
}
