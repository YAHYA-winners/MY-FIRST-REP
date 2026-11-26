import { describe, expect, it } from "vitest";
import { classifyReconciliation, summarizeReconciliation, type ScanEntry, type SnapshotEntry } from "@/lib/reconciliation";

const snap = (id: string, location: string | null, status: SnapshotEntry["expectedStatus"] = "IN_SERVICE"): SnapshotEntry => ({
  id: `s-${id}`,
  assetId: id,
  assetCode: `IMM-2026-0000${id}`,
  designation: `Bien ${id}`,
  serialNumber: null,
  categoryName: "Matériel informatique",
  expectedLocationId: location,
  expectedLocationPath: location,
  expectedStatus: status,
  grossValue: 1000,
  netBookValue: 600,
});

const scan = (assetId: string, locationId: string, at: string, condition: ScanEntry["condition"] = "GOOD"): ScanEntry => ({
  id: `scan-${assetId}-${at}`,
  assetId,
  locationId,
  condition,
  scannedAt: new Date(at),
  transferProposed: true,
});

describe("4-way physical / accounting reconciliation", () => {
  const lines = classifyReconciliation({
    snapshot: [snap("A", "L1"), snap("B", "L1"), snap("C", "L2"), snap("D", "L2", "MISSING")],
    scans: [
      scan("A", "L2", "2026-11-17T09:00:00Z"),
      scan("A", "L1", "2026-11-18T09:00:00Z"),
      scan("B", "L2", "2026-11-17T10:00:00Z", "DAMAGED"),
      scan("D", "L2", "2026-11-17T11:00:00Z"),
      scan("E", "L1", "2026-11-17T12:00:00Z"),
      scan("F", "L1", "2026-11-17T13:00:00Z"),
    ],
    extraAssets: [
      { assetId: "E", assetCode: "IMM-2025-00010", designation: "Hors périmètre", serialNumber: null, categoryName: "Mobilier", status: "IN_SERVICE", locationId: "L9", locationPath: "Autre site", grossValue: 500, netBookValue: 300 },
      { assetId: "F", assetCode: "IMM-2019-00001", designation: "Rebut", serialNumber: null, categoryName: "Mobilier", status: "DISPOSED", locationId: null, locationPath: null, grossValue: 800, netBookValue: 0 },
    ],
    surpluses: [
      { id: "S1", tempTag: "TMP-2026-00001", designation: "Fauteuil", serialNumber: null, categoryName: null, locationId: "L1", condition: "GOOD", estimatedValue: 950, status: "PENDING", scannedCode: null },
    ],
    locationPaths: new Map([
      ["L1", "Site > Bureau 1"],
      ["L2", "Site > Bureau 2"],
    ]),
  });
  const byKey = new Map(lines.map((l) => [l.key, l]));

  it("uses the latest scan of an asset (re-scan in the right room = match)", () => {
    const a = byKey.get("asset:A")!;
    expect(a.category).toBe("MATCH");
    expect(a.reasons).toContain("Scanné 2 fois");
  });

  it("flags location discrepancies and keeps the observed condition", () => {
    const b = byKey.get("asset:B")!;
    expect(b.category).toBe("MISPLACED");
    expect(b.foundLocationPath).toBe("Site > Bureau 2");
    expect(b.reasons.join(" ")).toContain("endommagé");
  });

  it("classifies never-scanned register items as missing", () => {
    expect(byKey.get("asset:C")!.category).toBe("MISSING");
  });

  it("requires status regularisation for an asset declared missing but found", () => {
    const dLine = byKey.get("asset:D")!;
    expect(dLine.category).toBe("MISPLACED");
    expect(dLine.reasons.join(" ")).toContain("statut à régulariser");
  });

  it("handles out-of-scope and disposed assets found on site", () => {
    expect(byKey.get("asset:E")!.category).toBe("MISPLACED");
    expect(byKey.get("asset:F")!.category).toBe("SURPLUS");
    expect(byKey.get("surplus:S1")!.category).toBe("SURPLUS");
    expect(byKey.get("surplus:S1")!.netBookValue).toBe(950);
  });

  it("summarises counts, values and rates", () => {
    const summary = summarizeReconciliation(lines);
    expect(summary.byCategory.MATCH.count).toBe(1);
    expect(summary.byCategory.MISPLACED.count).toBe(3);
    expect(summary.byCategory.MISSING.count).toBe(1);
    expect(summary.byCategory.SURPLUS.count).toBe(2);
    expect(summary.theoreticalCount).toBe(4);
    expect(summary.foundCount).toBe(3);
    expect(summary.physicalRate).toBeCloseTo(0.75);
    expect(summary.conformityRate).toBeCloseTo(0.25);
    expect(summary.byCategory.MISSING.netBookValue).toBe(600);
  });
});
