import { writeWorkbook, safeFileName } from "@/lib/exports/xlsx-helpers";
import { ASSET_STATUS_LABELS, DEPRECIATION_METHOD_LABELS, TAG_STATUS_LABELS } from "@/lib/constants";
import type { RegisterExportRow } from "@/actions/assets";
import type { AssetStatusValue, DepreciationMethodValue, TagStatusValue } from "@/lib/domain";
import { formatDate } from "@/lib/format";

interface RegisterPayload {
  asOf: string;
  company: { name: string; legalName: string | null; ice: string | null; currency: string };
  rows: RegisterExportRow[];
}

/** "Fichier des immobilisations" + "Balance des immobilisations" by accounting account. */
export function exportRegisterWorkbook(payload: RegisterPayload) {
  const { rows, company, asOf } = payload;
  const title = [
    `${company.legalName ?? company.name}${company.ice ? ` — ICE ${company.ice}` : ""}`,
    `Fichier des immobilisations arrêté au ${formatDate(asOf)} — montants en ${company.currency}`,
  ];

  const detail = rows.map((r) => [
    r.code,
    r.designation,
    r.brand,
    r.model,
    r.serialNumber,
    r.assetAccount,
    r.categoryName,
    r.supplier,
    r.invoiceNumber,
    r.acquisitionDate,
    r.commissioningDate,
    r.grossValue,
    DEPRECIATION_METHOD_LABELS[r.method as DepreciationMethodValue] ?? r.method,
    r.usefulLifeYears,
    r.rate / 100,
    r.currentYearAnnuity,
    r.accumulatedDepreciation,
    r.netBookValue,
    r.location,
    r.costCenter,
    r.custodian,
    ASSET_STATUS_LABELS[r.status as AssetStatusValue] ?? r.status,
    TAG_STATUS_LABELS[r.tagStatus as TagStatusValue] ?? r.tagStatus,
    r.disposalDate,
  ]);
  const sum = (pick: (r: RegisterExportRow) => number) => Math.round(rows.reduce((a, r) => a + pick(r), 0) * 100) / 100;

  const byAccount = new Map<string, { account: string; depAccount: string | null; category: string; count: number; gross: number; annuity: number; acc: number; nbv: number }>();
  for (const r of rows) {
    const key = `${r.assetAccount}|${r.categoryName}`;
    const b = byAccount.get(key) ?? { account: r.assetAccount, depAccount: r.depreciationAccount, category: r.categoryName, count: 0, gross: 0, annuity: 0, acc: 0, nbv: 0 };
    b.count += 1;
    b.gross += r.grossValue;
    b.annuity += r.currentYearAnnuity;
    b.acc += r.accumulatedDepreciation;
    b.nbv += r.netBookValue;
    byAccount.set(key, b);
  }
  const balance = [...byAccount.values()]
    .sort((a, b) => a.account.localeCompare(b.account))
    .map((b) => [b.account, b.category, b.depAccount, b.count, round(b.gross), round(b.annuity), round(b.acc), round(b.nbv)]);

  writeWorkbook(
    [
      {
        name: "Balance immobilisations",
        title: [title[0], `Balance des immobilisations au ${formatDate(asOf)} (${company.currency})`],
        header: ["Compte immo.", "Catégorie", "Compte amort.", "Nb biens", "Valeur brute", "Dotation exercice", "Amort. cumulés", "VNC"],
        rows: balance,
        widths: [14, 34, 14, 10, 18, 18, 18, 18],
        intCols: [3],
        moneyCols: [4, 5, 6, 7],
        totalsRow: ["TOTAL", "", "", rows.length, sum((r) => r.grossValue), sum((r) => r.currentYearAnnuity), sum((r) => r.accumulatedDepreciation), sum((r) => r.netBookValue)],
      },
      {
        name: "Fichier des immobilisations",
        title,
        header: [
          "Code",
          "Désignation",
          "Marque",
          "Modèle",
          "N° de série",
          "Compte",
          "Catégorie",
          "Fournisseur",
          "N° facture",
          "Date acquisition",
          "Mise en service",
          "Valeur brute HT",
          "Méthode",
          "Durée (ans)",
          "Taux",
          "Dotation exercice",
          "Amort. cumulés",
          "VNC",
          "Localisation",
          "Centre de coût",
          "Collaborateur",
          "Statut",
          "Étiquette",
          "Date de sortie",
        ],
        rows: detail,
        widths: [16, 36, 14, 18, 20, 10, 26, 26, 16, 14, 14, 16, 12, 10, 8, 16, 16, 16, 48, 24, 26, 20, 18, 14],
        moneyCols: [11, 15, 16, 17],
        intCols: [13],
        percentCols: [14],
        dateCols: [9, 10, 23],
        totalsRow: ["TOTAL", `${rows.length} biens`, "", "", "", "", "", "", "", "", "", sum((r) => r.grossValue), "", "", "", sum((r) => r.currentYearAnnuity), sum((r) => r.accumulatedDepreciation), sum((r) => r.netBookValue)],
      },
    ],
    `Fichier_immobilisations_${safeFileName(company.name)}_${asOf}.xlsx`,
    { Title: "Fichier des immobilisations", Company: company.name },
  );
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
