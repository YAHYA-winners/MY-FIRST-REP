import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatDate, formatDateTime, formatPlainAmount, pdfSafe } from "@/lib/format";

export interface HandoverData {
  company: { name: string; legalName: string | null; ice: string | null; address: string | null; city: string | null; currency: string };
  asset: { code: string; designation: string; brand: string | null; model: string | null; serialNumber: string | null; category: string; value: number; location: string | null };
  employee: { name: string; matricule: string; jobTitle: string | null; department: string | null };
  assignment: { assignedAt: string; condition: string; signerName: string | null; signedAt: string | null; signerIp: string | null; notes: string | null; assignedBy: string | null; returnedAt: string | null };
  signatureUrl: string | null;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** "Fiche de remise de matériel / Décharge" with the employee's e-signature. */
export async function generateHandoverPdf(d: HandoverData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(pdfSafe(d.company.legalName ?? d.company.name), M, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  doc.text(pdfSafe([d.company.address, d.company.city].filter(Boolean).join(", ")), M, 25);
  if (d.company.ice) doc.text(pdfSafe(`ICE : ${d.company.ice}`), M, 29);
  doc.setTextColor(0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(pdfSafe("FICHE DE REMISE DE MATÉRIEL — DÉCHARGE"), W / 2, 44, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(pdfSafe(`Réf. ${d.asset.code} — établie le ${formatDateTime(d.assignment.assignedAt)}`), W / 2, 50, { align: "center" });

  autoTable(doc, {
    startY: 58,
    theme: "grid",
    head: [[pdfSafe("Bien remis"), ""]],
    body: [
      ["Code immobilisation", d.asset.code],
      [pdfSafe("Désignation"), d.asset.designation],
      ["Marque / Modèle", [d.asset.brand, d.asset.model].filter(Boolean).join(" ") || "-"],
      [pdfSafe("N° de série"), d.asset.serialNumber ?? "-"],
      [pdfSafe("Catégorie"), d.asset.category],
      ["Valeur d'origine HT", `${formatPlainAmount(d.asset.value)} ${d.company.currency}`],
      ["Localisation", d.asset.location ?? "-"],
      [pdfSafe("État à la remise"), d.assignment.condition],
    ].map((r) => r.map((c) => pdfSafe(c))),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [29, 63, 143] },
    columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } },
    margin: { left: M, right: M },
  });

  const y1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y1,
    theme: "grid",
    head: [[pdfSafe("Bénéficiaire"), ""]],
    body: [
      ["Nom et prénom", d.employee.name],
      ["Matricule", d.employee.matricule],
      ["Fonction", d.employee.jobTitle ?? "-"],
      ["Direction / service", d.employee.department ?? "-"],
    ].map((r) => r.map((c) => pdfSafe(c))),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [29, 63, 143] },
    columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } },
    margin: { left: M, right: M },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(9);
  const clause = pdfSafe(
    `Je soussigné(e) ${d.employee.name} reconnais avoir reçu le matériel décrit ci-dessus, en ${d.assignment.condition.toLowerCase()}, ` +
      "pour un usage strictement professionnel. Je m'engage à en prendre soin, à signaler sans délai toute panne, perte ou vol, " +
      "à ne pas le céder ni le prêter à un tiers, et à le restituer à première demande ou à la fin de ma mission.",
  );
  const lines = doc.splitTextToSize(clause, W - 2 * M) as string[];
  doc.text(lines, M, y);
  y += lines.length * 4.4 + 4;
  if (d.assignment.notes) {
    const n = doc.splitTextToSize(pdfSafe(`Observations : ${d.assignment.notes}`), W - 2 * M) as string[];
    doc.text(n, M, y);
    y += n.length * 4.4 + 4;
  }

  const boxW = (W - 2 * M - 10) / 2;
  doc.setDrawColor(180);
  doc.rect(M, y, boxW, 48);
  doc.rect(M + boxW + 10, y, boxW, 48);
  doc.setFont("helvetica", "bold");
  doc.text(pdfSafe("Le bénéficiaire"), M + 3, y + 6);
  doc.text(pdfSafe("Pour la société (remis par)"), M + boxW + 13, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(pdfSafe(d.assignment.signerName ?? d.employee.name), M + 3, y + 11);
  doc.text(pdfSafe(d.assignment.assignedBy ?? ""), M + boxW + 13, y + 11);
  if (d.signatureUrl) {
    const img = await fetchAsDataUrl(d.signatureUrl);
    if (img) doc.addImage(img, "PNG", M + 3, y + 13, boxW - 6, 26);
  }
  doc.setTextColor(90);
  doc.text(
    pdfSafe(`Signé électroniquement le ${formatDateTime(d.assignment.signedAt)}${d.assignment.signerIp ? ` — IP ${d.assignment.signerIp}` : ""}`),
    M + 3,
    y + 45,
  );
  doc.setTextColor(0);
  if (d.assignment.returnedAt) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(pdfSafe(`Matériel restitué le ${formatDate(d.assignment.returnedAt)}`), M, y + 58);
  }
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(pdfSafe(`Document généré par ImmoTrack le ${formatDateTime(new Date())} — trace conservée dans l'historique immuable du bien.`), M, 287);
  doc.save(`Decharge_${d.asset.code}_${d.employee.matricule}.pdf`);
}
