import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { CAMPAIGN_STATUS_LABELS, RECON_CATEGORY_LONG_LABELS, RESOLUTION_STATUS_LABELS } from "@/lib/constants";
import { RECON_CATEGORIES } from "@/lib/domain";
import { RESOLUTION_ACTION_LABELS, type ReconRow, type ReconciliationReport } from "@/lib/report-types";
import { formatDate, formatDateTime, formatPlainAmount, pdfSafe } from "@/lib/format";

const PRIMARY: [number, number, number] = [29, 63, 143];
const M = 15;
const W = 210;

type DocWithTable = jsPDF & { lastAutoTable: { finalY: number } };

async function fingerprint(report: ReconciliationReport): Promise<string> {
  const payload = JSON.stringify({
    campaign: report.campaign.code,
    pv: report.campaign.pvNumber,
    rows: report.rows.map((r) => [r.category, r.assetCode, r.expectedLocationPath, r.foundLocationPath, r.netBookValue, r.resolution, r.resolutionAction]),
  });
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "indisponible (contexte non sécurisé)";
  }
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  if (y > 260) {
    doc.addPage();
    y = 20;
  }
  doc.setFillColor(...PRIMARY);
  doc.rect(M, y - 4.2, 2, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(pdfSafe(text), M + 4, y);
  doc.setFont("helvetica", "normal");
  return y + 5;
}

function paragraph(doc: jsPDF, text: string, y: number, size = 9): number {
  doc.setFontSize(size);
  doc.setTextColor(40);
  const lines = doc.splitTextToSize(pdfSafe(text), W - 2 * M) as string[];
  if (y + lines.length * 4.3 > 280) {
    doc.addPage();
    y = 20;
  }
  doc.text(lines, M, y);
  return y + lines.length * 4.3 + 2;
}

function pct(rate: number) {
  return `${(rate * 100).toFixed(1).replace(".", ",")} %`;
}

function money(v: number, cur: string) {
  return `${formatPlainAmount(v)} ${cur}`;
}

function discrepancyTable(doc: DocWithTable, rows: ReconRow[], y: number, cur: string, mode: "missing" | "misplaced" | "surplus" | "match") {
  const head =
    mode === "misplaced"
      ? [["Code", "Désignation", "Localisation comptable", "Localisation constatée", "VNC", "Régularisation"]]
      : mode === "surplus"
        ? [["Code / étiquette", "Désignation", "Localisation constatée", "Valeur est.", "Régularisation"]]
        : mode === "match"
          ? [["Code", "Désignation", "Localisation", "VNC"]]
          : [["Code", "Désignation", "Localisation comptable", "Valeur brute", "VNC", "Régularisation"]];
  const body = rows.map((r) => {
    const reg = `${RESOLUTION_STATUS_LABELS[r.resolution]}${r.resolutionAction && r.resolutionAction !== "CONFORME" ? ` (${RESOLUTION_ACTION_LABELS[r.resolutionAction] ?? r.resolutionAction})` : ""}`;
    if (mode === "misplaced") return [r.assetCode, r.designation, r.expectedLocationPath ?? "-", r.foundLocationPath ?? "-", money(r.netBookValue, cur), reg];
    if (mode === "surplus") return [r.assetCode, r.designation, r.foundLocationPath ?? "-", money(r.netBookValue, cur), reg];
    if (mode === "match") return [r.assetCode, r.designation, r.foundLocationPath ?? "-", money(r.netBookValue, cur)];
    return [r.assetCode, r.designation, r.expectedLocationPath ?? "-", money(r.grossValue, cur), money(r.netBookValue, cur), reg];
  });
  autoTable(doc, {
    startY: y,
    head: head.map((h) => h.map(pdfSafe)),
    body: body.map((row) => row.map((c) => pdfSafe(String(c)))),
    theme: "striped",
    styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak" },
    headStyles: { fillColor: PRIMARY, fontSize: 7.2 },
    columnStyles:
      mode === "match"
        ? { 0: { cellWidth: 28, font: "courier" }, 3: { halign: "right", cellWidth: 30 } }
        : mode === "surplus"
          ? { 0: { cellWidth: 28, font: "courier" }, 3: { halign: "right", cellWidth: 26 }, 4: { cellWidth: 32 } }
          : mode === "misplaced"
            ? { 0: { cellWidth: 26, font: "courier" }, 4: { halign: "right", cellWidth: 24 }, 5: { cellWidth: 28 } }
            : { 0: { cellWidth: 26, font: "courier" }, 3: { halign: "right", cellWidth: 24 }, 4: { halign: "right", cellWidth: 24 }, 5: { cellWidth: 28 } },
    margin: { left: M, right: M, top: 18, bottom: 18 },
  });
  return doc.lastAutoTable.finalY + 6;
}

/** Formal "Procès-Verbal d'inventaire physique des immobilisations" ready for signatures. */
export async function generatePvPdf(report: ReconciliationReport) {
  const { company, campaign, summary, rows } = report;
  const cur = company.currency;
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true }) as DocWithTable;
  const validated = campaign.status === "VALIDATED";
  doc.setProperties({ title: `PV d'inventaire ${campaign.code}`, subject: "Procès-verbal d'inventaire physique des immobilisations", creator: "ImmoTrack" });

  // ---- Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(pdfSafe(company.legalName ?? company.name), M, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  const ids = [company.ice && `ICE ${company.ice}`, company.taxId && `IF ${company.taxId}`, company.tradeRegister && `RC ${company.tradeRegister}`].filter(Boolean).join(" · ");
  doc.text(pdfSafe([company.address, company.city].filter(Boolean).join(", ")), M, 23);
  if (ids) doc.text(pdfSafe(ids), M, 27);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PRIMARY);
  doc.text(pdfSafe(campaign.pvNumber ?? "PROJET — NON VALIDÉ"), W - M, 18, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  doc.setFontSize(8);
  doc.text(pdfSafe(`Édité le ${formatDateTime(report.generatedAt)}`), W - M, 23, { align: "right" });

  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.6);
  doc.line(M, 31, W - M, 31);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20);
  doc.text(pdfSafe("PROCÈS-VERBAL D'INVENTAIRE PHYSIQUE"), W / 2, 41, { align: "center" });
  doc.text(pdfSafe("DES IMMOBILISATIONS CORPORELLES"), W / 2, 48, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(pdfSafe(`Campagne ${campaign.code} — ${campaign.name}`), W / 2, 55, { align: "center" });

  if (!validated) {
    doc.setTextColor(220, 60, 60);
    doc.setFontSize(8.5);
    doc.text(pdfSafe(`Document provisoire — statut de la campagne : ${CAMPAIGN_STATUS_LABELS[campaign.status]}`), W / 2, 60, { align: "center" });
  }

  // ---- 1. Objet
  let y = sectionTitle(doc, "1. Objet et cadre réglementaire", 70);
  y = paragraph(
    doc,
    `Le présent procès-verbal constate les résultats de l'inventaire physique des immobilisations de ${company.legalName ?? company.name}, ` +
      "réalisé en application de l'obligation de contrôle par inventaire, au moins une fois tous les douze mois, de l'existence et de la valeur des éléments d'actif " +
      "(loi n° 9-88 relative aux obligations comptables des commerçants, art. 5) et des principes du Code Général de Normalisation Comptable. " +
      "Il présente le rapprochement entre le fichier comptable des immobilisations, figé au lancement de la campagne, et le constat physique effectué sur site.",
    y,
  );

  // ---- 2. Organisation
  y = sectionTitle(doc, "2. Périmètre, organisation et méthodologie", y + 2);
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.2 },
    columnStyles: { 0: { cellWidth: 58, fontStyle: "bold", textColor: 70 } },
    body: [
      ["Période de comptage", `${formatDate(campaign.launchedAt ?? campaign.plannedStartDate)} au ${formatDate(campaign.countClosedAt ?? campaign.plannedEndDate)}`],
      ["Gel du fichier théorique", formatDateTime(campaign.launchedAt)],
      ["Périmètre géographique", campaign.scope.length ? campaign.scope.join(" ; ") : "Ensemble des sites de la société"],
      ["Catégories inventoriées", campaign.categories.length ? campaign.categories.join(", ") : "Toutes les catégories suivies physiquement"],
      ["Équipe d'inventaire", campaign.team.length ? campaign.team.map((t) => `${t.name}${t.role === "LEAD" ? " (responsable)" : ""}`).join(", ") : "-"],
      ["Méthode", `Identification par étiquettes QR et scan mobile, ${campaign.scansCount} constat(s) horodaté(s) et tracé(s) ; saisie avec photo des biens non étiquetés.`],
    ].map((r) => r.map((c) => pdfSafe(c))),
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---- 3. Synthèse
  y = sectionTitle(doc, "3. Synthèse du rapprochement physico-comptable", y);
  autoTable(doc, {
    startY: y,
    head: [["Résultat", "Nombre", "Valeur brute", "VNC"].map(pdfSafe)],
    body: [
      ...RECON_CATEGORIES.map((c) => [
        RECON_CATEGORY_LONG_LABELS[c],
        String(summary.byCategory[c].count),
        money(summary.byCategory[c].grossValue, cur),
        money(summary.byCategory[c].netBookValue, cur),
      ]),
    ].map((r) => r.map((c) => pdfSafe(c))),
    foot: [
      [
        pdfSafe(`Fichier théorique : ${summary.theoreticalCount} biens — retrouvés : ${summary.foundCount} (${pct(summary.physicalRate)}) — conformité : ${pct(summary.conformityRate)}`),
        "",
        "",
        "",
      ],
    ],
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 1.8 },
    headStyles: { fillColor: PRIMARY },
    footStyles: { fillColor: [235, 239, 247], textColor: 30, fontStyle: "bold", fontSize: 8 },
    columnStyles: { 1: { halign: "center", cellWidth: 20 }, 2: { halign: "right", cellWidth: 36 }, 3: { halign: "right", cellWidth: 36 } },
    margin: { left: M, right: M },
    didParseCell: (data) => {
      if (data.section === "foot" && data.column.index === 0) data.cell.colSpan = 4;
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---- 4. Impact financier
  const missing = rows.filter((r) => r.category === "MISSING");
  const misplaced = rows.filter((r) => r.category === "MISPLACED");
  const surplus = rows.filter((r) => r.category === "SURPLUS");
  const sum = (list: ReconRow[], pick: (r: ReconRow) => number) => list.reduce((a, r) => a + pick(r), 0);
  const declared = missing.filter((r) => r.resolutionAction === "DECLARED_MISSING");
  const integrated = surplus.filter((r) => r.resolutionAction === "INTEGRATED");
  const synced = misplaced.filter((r) => r.resolutionAction === "LOCATION_SYNCED");
  y = sectionTitle(doc, "4. Impact financier et régularisations", y);
  y = paragraph(
    doc,
    `Écarts négatifs : ${missing.length} bien(s) non retrouvé(s), valeur brute ${money(sum(missing, (r) => r.grossValue), cur)}, ` +
      `VNC ${money(sum(missing, (r) => r.netBookValue), cur)}. Si la disparition est confirmée, la VNC correspondante est à constater en charges non courantes ` +
      `(sortie d'actif) après décision de la Direction. ${declared.length} bien(s) ont été déclarés disparus dans le registre.`,
    y,
  );
  y = paragraph(
    doc,
    `Écarts de localisation : ${misplaced.length} bien(s) retrouvé(s) hors de leur localisation comptable ; ${synced.length} localisation(s) ` +
      `ont été synchronisées avec le constat physique. Écarts positifs : ${surplus.length} bien(s) en excédent pour une valeur estimée de ` +
      `${money(sum(surplus, (r) => r.netBookValue), cur)} ; ${integrated.length} intégré(s) à l'actif.`,
    y,
  );
  const open = rows.filter((r) => r.category !== "MATCH" && r.resolution === "OPEN").length;
  y = paragraph(doc, open ? `${open} écart(s) restent en cours d'analyse à la date du présent procès-verbal.` : "L'ensemble des écarts a fait l'objet d'une régularisation ou d'une justification.", y);

  // ---- 5. Détail des écarts
  y = sectionTitle(doc, "5. Détail des écarts", y + 2);
  const blocks: [string, ReconRow[], "missing" | "misplaced" | "surplus"][] = [
    ["5.1 Écarts négatifs — biens manquants", missing, "missing"],
    ["5.2 Écarts de localisation / affectation", misplaced, "misplaced"],
    ["5.3 Écarts positifs — surplus", surplus, "surplus"],
  ];
  for (const [title, list, mode] of blocks) {
    if (y > 255) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(pdfSafe(`${title} (${list.length})`), M, y);
    doc.setFont("helvetica", "normal");
    y += 2;
    if (list.length === 0) {
      y = paragraph(doc, "Néant.", y + 3, 8.5);
    } else {
      y = discrepancyTable(doc, list, y, cur, mode);
    }
  }

  // ---- 6. Observations
  y = sectionTitle(doc, "6. Observations et réserves", y + 2);
  if (campaign.pvObservations) {
    y = paragraph(doc, campaign.pvObservations, y);
  } else {
    doc.setDrawColor(200);
    for (let i = 0; i < 4; i++) {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      doc.line(M, y + 4, W - M, y + 4);
      y += 7;
    }
  }

  // ---- 7. Signatures
  if (y > 215) {
    doc.addPage();
    y = 20;
  }
  y = sectionTitle(doc, "7. Signatures", y + 4);
  y = paragraph(doc, `Fait à ${company.city ?? "………………"}, le ${validated ? formatDate(campaign.validatedAt) : "………………"}, en autant d'exemplaires que de signataires.`, y, 8.5);
  const signers = ["Le Responsable de l'inventaire", "Le Directeur Administratif et Financier", "Le Directeur Général", "Le Commissaire aux comptes / Auditeur externe"];
  const boxW = (W - 2 * M - 6) / 2;
  const boxH = 30;
  signers.forEach((label, i) => {
    const bx = M + (i % 2) * (boxW + 6);
    const by = y + Math.floor(i / 2) * (boxH + 5);
    doc.setDrawColor(170);
    doc.rect(bx, by, boxW, boxH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(30);
    doc.text(pdfSafe(label), bx + 3, by + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(pdfSafe("Nom, date et signature :"), bx + 3, by + 10);
  });

  // ---- Annex: conformes
  const matches = rows.filter((r) => r.category === "MATCH");
  if (matches.length) {
    doc.addPage();
    const annexY = sectionTitle(doc, `Annexe — Biens conformes (${matches.length})`, 20);
    discrepancyTable(doc, matches, annexY, cur, "match");
  }

  // ---- Footer on every page
  const hash = await fingerprint(report);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(6.8);
    doc.setTextColor(130);
    doc.setDrawColor(220);
    doc.line(M, 286, W - M, 286);
    doc.text(pdfSafe(`${campaign.pvNumber ?? "PROJET"} — ${campaign.code} — Empreinte SHA-256 : ${hash.slice(0, 32)}…`), M, 290);
    doc.text(pdfSafe(`Page ${p} / ${pages}`), W - M, 290, { align: "right" });
  }

  doc.save(`PV_inventaire_${campaign.code}${campaign.pvNumber ? `_${campaign.pvNumber}` : "_projet"}.pdf`);
}
