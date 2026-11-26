import { jsPDF } from "jspdf";
import { labelSlotPosition, labelsPerPage, type LabelItem, type LabelTemplate } from "@/lib/labels";
import { renderQrDataUrls } from "@/lib/exports/qr-images";
import { pdfSafe } from "@/lib/format";

export interface LabelPdfOptions {
  template: LabelTemplate;
  companyName: string;
  showCompany: boolean;
  showTitle: boolean;
  showSubtitle: boolean;
  /** Skip the first N slots of the first sheet (partially used A4 sheets). */
  startPosition: number;
  drawBorders: boolean;
}

const PT_TO_MM = 0.3528;

function fitText(doc: jsPDF, text: string, maxWidth: number, maxPt: number, minPt: number): { text: string; size: number } {
  let size = maxPt;
  doc.setFontSize(size);
  while (size > minPt && doc.getTextWidth(text) > maxWidth) {
    size -= 0.25;
    doc.setFontSize(size);
  }
  let out = text;
  while (out.length > 1 && doc.getTextWidth(out) > maxWidth) out = `${out.slice(0, -2)}…`;
  return { text: out, size };
}

function drawLabel(doc: jsPDF, x: number, y: number, w: number, h: number, item: LabelItem, image: string, o: LabelPdfOptions) {
  const pad = Math.max(1.2, Math.min(w, h) * 0.06);
  if (o.drawBorders) {
    doc.setDrawColor(200);
    doc.setLineWidth(0.1);
    doc.roundedRect(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 1, 1);
  }
  const vertical = w / h < 1.45;
  doc.setTextColor(0);

  if (vertical) {
    const footer = h * 0.3;
    const qr = Math.min(w - 2 * pad, h - footer - pad);
    doc.addImage(image, "PNG", x + (w - qr) / 2, y + pad, qr, qr, item.code, "FAST");
    let cy = y + pad + qr + 0.6;
    doc.setFont("courier", "bold");
    const code = fitText(doc, pdfSafe(item.code), w - 2 * pad, Math.min(10, h * 0.32), 5);
    doc.text(code.text, x + w / 2, cy, { align: "center", baseline: "top" });
    cy += code.size * PT_TO_MM + 0.4;
    if (o.showCompany && cy < y + h - pad) {
      doc.setFont("helvetica", "normal");
      const company = fitText(doc, pdfSafe(o.companyName), w - 2 * pad, Math.min(6, h * 0.2), 3.5);
      doc.text(company.text, x + w / 2, cy, { align: "center", baseline: "top" });
    }
    return;
  }

  const qr = h - 2 * pad;
  doc.addImage(image, "PNG", x + pad, y + pad, qr, qr, item.code, "FAST");
  const tx = x + pad * 1.8 + qr;
  const tw = x + w - pad - tx;
  const bottom = y + h - pad;
  let cy = y + pad;

  if (o.showCompany) {
    doc.setFont("helvetica", "bold");
    const company = fitText(doc, pdfSafe(o.companyName.toUpperCase()), tw, Math.min(7, h * 0.22), 3.5);
    doc.text(company.text, tx, cy, { baseline: "top" });
    cy += company.size * PT_TO_MM + 0.6;
  }
  doc.setFont("courier", "bold");
  const code = fitText(doc, pdfSafe(item.code), tw, Math.min(13, h * 0.38), 5);
  doc.text(code.text, tx, cy, { baseline: "top" });
  cy += code.size * PT_TO_MM + 0.8;

  const remaining = bottom - cy;
  if (o.showTitle && remaining > 1.5) {
    doc.setFont("helvetica", "normal");
    const size = Math.max(4, Math.min(7.5, h * 0.24));
    doc.setFontSize(size);
    const lineH = size * PT_TO_MM * 1.15;
    const reserve = o.showSubtitle && item.subtitle ? lineH : 0;
    const maxLines = Math.max(1, Math.floor((remaining - reserve) / lineH));
    const lines = (doc.splitTextToSize(pdfSafe(item.title), tw) as string[]).slice(0, maxLines);
    if ((doc.splitTextToSize(pdfSafe(item.title), tw) as string[]).length > maxLines && lines.length) {
      lines[lines.length - 1] = fitText(doc, `${lines[lines.length - 1]}…`, tw, size, size).text;
    }
    doc.setFontSize(size);
    doc.text(lines, tx, cy, { baseline: "top", lineHeightFactor: 1.15 });
    cy += lines.length * lineH;
  }
  if (o.showSubtitle && item.subtitle && bottom - cy > 1) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    const sub = fitText(doc, pdfSafe(item.subtitle), tw, Math.max(3.5, Math.min(6, h * 0.19)), 3.5);
    doc.text(sub.text, tx, Math.min(cy + 0.2, bottom - sub.size * PT_TO_MM), { baseline: "top" });
    doc.setTextColor(0);
  }
}

/** Builds a print-ready PDF of QR labels for thermal rolls or A4 sticker sheets. */
export async function buildLabelsPdf(items: LabelItem[], options: LabelPdfOptions): Promise<jsPDF> {
  const t = options.template;
  const doc = new jsPDF({
    unit: "mm",
    format: [t.pageWidth, t.pageHeight],
    orientation: t.pageWidth > t.pageHeight ? "landscape" : "portrait",
    compress: true,
  });
  doc.setProperties({ title: "Étiquettes QR immobilisations", creator: "ImmoTrack" });
  const images = await renderQrDataUrls(items.map((i) => i.qrPayload));
  const perPage = labelsPerPage(t);
  const start = t.kind === "sheet" || t.kind === "custom" ? Math.min(Math.max(0, options.startPosition), perPage - 1) : 0;
  let currentPage = 0;
  items.forEach((item, index) => {
    const slot = start + index;
    const page = Math.floor(slot / perPage);
    while (currentPage < page) {
      doc.addPage([t.pageWidth, t.pageHeight], t.pageWidth > t.pageHeight ? "landscape" : "portrait");
      currentPage += 1;
    }
    const { x, y } = labelSlotPosition(t, slot % perPage);
    drawLabel(doc, x, y, t.labelWidth, t.labelHeight, item, images[index], options);
  });
  return doc;
}

export function openPdfForPrint(doc: jsPDF, fileName: string) {
  doc.autoPrint();
  const url = doc.output("bloburl");
  const win = window.open(url as unknown as string, "_blank");
  if (!win) doc.save(fileName);
}
