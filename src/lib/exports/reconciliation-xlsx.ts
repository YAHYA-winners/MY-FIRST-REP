import { safeFileName, writeWorkbook, type SheetSpec } from "@/lib/exports/xlsx-helpers";
import {
  ASSET_CONDITION_LABELS,
  ASSET_STATUS_LABELS,
  CAMPAIGN_STATUS_LABELS,
  RECON_CATEGORY_LONG_LABELS,
  RESOLUTION_STATUS_LABELS,
} from "@/lib/constants";
import { RECON_CATEGORIES } from "@/lib/domain";
import { RESOLUTION_ACTION_LABELS, type ReconRow, type ReconciliationReport } from "@/lib/report-types";
import { formatDate, formatDateTime } from "@/lib/format";

const r2 = (v: number) => Math.round(v * 100) / 100;

function resolutionText(r: ReconRow) {
  const action = r.resolutionAction ? RESOLUTION_ACTION_LABELS[r.resolutionAction] ?? r.resolutionAction : "";
  return [RESOLUTION_STATUS_LABELS[r.resolution], action].filter(Boolean).join(" — ");
}

/**
 * Official reconciliation workbook: Synthèse, Conformes, Déplacés, Manquants,
 * Surplus and Impact financier (VNC) by accounting category.
 */
export function exportReconciliationWorkbook(report: ReconciliationReport) {
  const { company, campaign, summary, rows } = report;
  const cur = company.currency;
  const header = [
    `${company.legalName ?? company.name}${company.ice ? ` — ICE ${company.ice}` : ""}`,
    `Rapprochement physico-comptable — ${campaign.code} « ${campaign.name} »`,
    `Statut : ${CAMPAIGN_STATUS_LABELS[campaign.status]}${campaign.pvNumber ? ` — ${campaign.pvNumber}` : ""} — édité le ${formatDateTime(report.generatedAt)} — montants en ${cur}`,
  ];
  const by = (cat: ReconRow["category"]) => rows.filter((r) => r.category === cat);

  const synthese: SheetSpec = {
    name: "Synthèse",
    title: header,
    header: ["Catégorie d'écart", "Nombre", "Valeur brute", "VNC", "% du fichier théorique"],
    rows: [
      ...RECON_CATEGORIES.map((c) => [
        RECON_CATEGORY_LONG_LABELS[c],
        summary.byCategory[c].count,
        summary.byCategory[c].grossValue,
        summary.byCategory[c].netBookValue,
        c === "SURPLUS" || !summary.theoreticalCount ? "" : summary.byCategory[c].count / summary.theoreticalCount,
      ]),
      [],
      ["Biens au fichier théorique", summary.theoreticalCount, "", "", ""],
      ["Biens retrouvés physiquement", summary.foundCount, "", "", summary.physicalRate],
      ["Taux de conformité (match parfait)", summary.byCategory.MATCH.count, "", "", summary.conformityRate],
      ["Scans enregistrés", campaign.scansCount, "", "", ""],
      [],
      ["Lancement (gel du fichier théorique)", formatDateTime(campaign.launchedAt)],
      ["Clôture du comptage", formatDateTime(campaign.countClosedAt)],
      ["Validation du PV", formatDateTime(campaign.validatedAt)],
      ["Périmètre", campaign.scope.length ? campaign.scope.join(" ; ") : "Toute la société"],
    ],
    widths: [52, 14, 20, 20, 22],
    intCols: [1],
    moneyCols: [2, 3],
    percentCols: [4],
  };

  const detailHeader = ["Code", "Désignation", "Catégorie", "N° de série", "Localisation comptable", "Localisation constatée", "Statut comptable", "État constaté", "Valeur brute", "VNC", "Motifs", "Régularisation", "Note", "Par", "Le"];
  const detailRows = (list: ReconRow[]) =>
    list.map((r) => [
      r.assetCode,
      r.designation,
      r.categoryName,
      r.serialNumber,
      r.expectedLocationPath,
      r.foundLocationPath,
      r.expectedStatus ? ASSET_STATUS_LABELS[r.expectedStatus] : "",
      r.condition ? ASSET_CONDITION_LABELS[r.condition] : "",
      r.grossValue,
      r.netBookValue,
      r.reasons.join(" | "),
      resolutionText(r),
      r.resolutionNote,
      r.resolvedBy,
      r.resolvedAt ? formatDate(r.resolvedAt) : "",
    ]);
  const detailSheet = (name: string, list: ReconRow[]): SheetSpec => ({
    name,
    title: [header[0], `${name} — ${list.length} ligne(s)`],
    header: detailHeader,
    rows: detailRows(list),
    widths: [16, 36, 24, 18, 44, 44, 18, 14, 16, 16, 60, 32, 36, 18, 12],
    moneyCols: [8, 9],
    totalsRow: list.length
      ? ["TOTAL", `${list.length} bien(s)`, "", "", "", "", "", "", r2(list.reduce((a, r) => a + r.grossValue, 0)), r2(list.reduce((a, r) => a + r.netBookValue, 0))]
      : undefined,
  });

  const impact = new Map<string, { missingCount: number; missingGross: number; missingNbv: number; surplusCount: number; surplusValue: number; misplacedCount: number; misplacedNbv: number }>();
  for (const r of rows) {
    const key = r.categoryName ?? "Non classé";
    const b = impact.get(key) ?? { missingCount: 0, missingGross: 0, missingNbv: 0, surplusCount: 0, surplusValue: 0, misplacedCount: 0, misplacedNbv: 0 };
    if (r.category === "MISSING") {
      b.missingCount += 1;
      b.missingGross += r.grossValue;
      b.missingNbv += r.netBookValue;
    } else if (r.category === "SURPLUS") {
      b.surplusCount += 1;
      b.surplusValue += r.netBookValue;
    } else if (r.category === "MISPLACED") {
      b.misplacedCount += 1;
      b.misplacedNbv += r.netBookValue;
    }
    impact.set(key, b);
  }
  const impactRows = [...impact.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([name, b]) => [name, b.missingCount, r2(b.missingGross), r2(b.missingNbv), b.misplacedCount, r2(b.misplacedNbv), b.surplusCount, r2(b.surplusValue), r2(b.surplusValue - b.missingNbv)]);
  const totals = [...impact.values()].reduce(
    (a, b) => ({
      mc: a.mc + b.missingCount,
      mg: a.mg + b.missingGross,
      mn: a.mn + b.missingNbv,
      pc: a.pc + b.misplacedCount,
      pn: a.pn + b.misplacedNbv,
      sc: a.sc + b.surplusCount,
      sv: a.sv + b.surplusValue,
    }),
    { mc: 0, mg: 0, mn: 0, pc: 0, pn: 0, sc: 0, sv: 0 },
  );

  writeWorkbook(
    [
      synthese,
      detailSheet("Conformes", by("MATCH")),
      detailSheet("Déplacés", by("MISPLACED")),
      detailSheet("Manquants", by("MISSING")),
      detailSheet("Surplus", by("SURPLUS")),
      {
        name: "Impact financier",
        title: [header[0], "Impact financier des écarts par catégorie comptable (VNC)", "Manquants : VNC à constater en charges non courantes si la disparition est confirmée. Surplus : valeur estimée à intégrer."],
        header: ["Catégorie", "Manquants (nb)", "Manquants valeur brute", "Manquants VNC", "Déplacés (nb)", "Déplacés VNC", "Surplus (nb)", "Surplus valeur estimée", "Impact net (surplus − manquants)"],
        rows: impactRows,
        widths: [34, 14, 20, 18, 14, 18, 12, 20, 26],
        intCols: [1, 4, 6],
        moneyCols: [2, 3, 5, 7, 8],
        totalsRow: ["TOTAL", totals.mc, r2(totals.mg), r2(totals.mn), totals.pc, r2(totals.pn), totals.sc, r2(totals.sv), r2(totals.sv - totals.mn)],
      },
    ],
    `Rapprochement_${safeFileName(campaign.code)}_${report.generatedAt.slice(0, 10)}.xlsx`,
    { Title: `Rapprochement physico-comptable ${campaign.code}`, Company: company.name },
  );
}
