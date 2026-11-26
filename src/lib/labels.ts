/** QR label templates (dimensions in millimetres). Pure & client-safe. */
export interface LabelTemplate {
  key: string;
  name: string;
  kind: "thermal" | "sheet" | "custom";
  pageWidth: number;
  pageHeight: number;
  labelWidth: number;
  labelHeight: number;
  columns: number;
  rows: number;
  marginTop: number;
  marginLeft: number;
  gapX: number;
  gapY: number;
}

export interface LabelItem {
  id: string;
  qrPayload: string;
  code: string;
  title: string;
  subtitle?: string | null;
}

export const LABEL_TEMPLATES: LabelTemplate[] = [
  { key: "thermal-50x25", name: "Rouleau thermique 50 × 25 mm", kind: "thermal", pageWidth: 50, pageHeight: 25, labelWidth: 50, labelHeight: 25, columns: 1, rows: 1, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 },
  { key: "thermal-57x32", name: "Rouleau thermique 57 × 32 mm", kind: "thermal", pageWidth: 57, pageHeight: 32, labelWidth: 57, labelHeight: 32, columns: 1, rows: 1, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 },
  { key: "thermal-40x30", name: "Rouleau thermique 40 × 30 mm", kind: "thermal", pageWidth: 40, pageHeight: 30, labelWidth: 40, labelHeight: 30, columns: 1, rows: 1, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 },
  { key: "thermal-100x50", name: "Rouleau thermique 100 × 50 mm (équipements lourds)", kind: "thermal", pageWidth: 100, pageHeight: 50, labelWidth: 100, labelHeight: 50, columns: 1, rows: 1, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 },
  { key: "a4-l7651", name: "Planche A4 — 65 étiquettes 38,1 × 21,2 mm (type Avery L7651)", kind: "sheet", pageWidth: 210, pageHeight: 297, labelWidth: 38.1, labelHeight: 21.2, columns: 5, rows: 13, marginTop: 10.7, marginLeft: 4.75, gapX: 2.5, gapY: 0 },
  { key: "a4-3474", name: "Planche A4 — 24 étiquettes 70 × 37 mm (type Avery 3474)", kind: "sheet", pageWidth: 210, pageHeight: 297, labelWidth: 70, labelHeight: 37, columns: 3, rows: 8, marginTop: 0.5, marginLeft: 0, gapX: 0, gapY: 0 },
  { key: "a4-l7160", name: "Planche A4 — 21 étiquettes 63,5 × 38,1 mm (type Avery L7160)", kind: "sheet", pageWidth: 210, pageHeight: 297, labelWidth: 63.5, labelHeight: 38.1, columns: 3, rows: 7, marginTop: 15.15, marginLeft: 7.25, gapX: 2.5, gapY: 0 },
  { key: "a4-l7163", name: "Planche A4 — 14 étiquettes 99,1 × 38,1 mm (type Avery L7163)", kind: "sheet", pageWidth: 210, pageHeight: 297, labelWidth: 99.1, labelHeight: 38.1, columns: 2, rows: 7, marginTop: 15.15, marginLeft: 4.65, gapX: 2.5, gapY: 0 },
];

export function labelsPerPage(t: LabelTemplate): number {
  return Math.max(1, t.columns * t.rows);
}

export function labelSlotPosition(t: LabelTemplate, slotOnPage: number): { x: number; y: number } {
  const col = slotOnPage % t.columns;
  const row = Math.floor(slotOnPage / t.columns);
  return {
    x: t.marginLeft + col * (t.labelWidth + t.gapX),
    y: t.marginTop + row * (t.labelHeight + t.gapY),
  };
}

export function validateTemplate(t: LabelTemplate): string | null {
  if (t.labelWidth < 15 || t.labelHeight < 10) return "Étiquette trop petite (15 × 10 mm minimum).";
  const usedW = t.marginLeft + t.columns * t.labelWidth + (t.columns - 1) * t.gapX;
  const usedH = t.marginTop + t.rows * t.labelHeight + (t.rows - 1) * t.gapY;
  if (usedW > t.pageWidth + 0.5 || usedH > t.pageHeight + 0.5) return "Les étiquettes dépassent les dimensions de la page.";
  return null;
}
