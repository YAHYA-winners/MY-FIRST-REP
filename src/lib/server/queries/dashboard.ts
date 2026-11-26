import "server-only";
import type { Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assetDepreciation } from "@/lib/depreciation";
import { formatMonthLabel } from "@/lib/format";
import { round2 } from "@/lib/utils";
import type { AssetStatusValue } from "@/lib/domain";
import { computeCampaignProgress, type ProgressDatum } from "@/lib/server/queries/campaigns";

export interface CategoryDatum {
  name: string;
  count: number;
  gross: number;
  nbv: number;
}


export async function getDashboardData(company: Company) {
  const now = new Date();
  const [assets, categories, pendingInvoices, recentEvents, latestCampaign, activeCampaigns] = await Promise.all([
    prisma.asset.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        acquisitionValue: true,
        residualValue: true,
        depreciationMethod: true,
        usefulLifeYears: true,
        decliningCoefficient: true,
        acquisitionDate: true,
        commissioningDate: true,
        disposalDate: true,
        status: true,
        tagStatus: true,
        categoryId: true,
      },
    }),
    prisma.assetCategory.findMany({ where: { companyId: company.id }, select: { id: true, name: true } }),
    prisma.invoice.count({ where: { companyId: company.id, status: { in: ["UPLOADED", "EXTRACTING", "EXTRACTED", "FAILED"] } } }),
    prisma.assetEvent.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        type: true,
        summary: true,
        createdAt: true,
        asset: { select: { id: true, code: true, designation: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.inventoryCampaign.findFirst({
      where: { companyId: company.id, status: { not: "DRAFT" } },
      orderBy: [{ launchedAt: "desc" }],
      select: { id: true, code: true, name: true, status: true, launchedAt: true },
    }),
    prisma.inventoryCampaign.findMany({
      where: { companyId: company.id, status: { in: ["IN_PROGRESS", "COUNT_CLOSED"] } },
      orderBy: { launchedAt: "desc" },
      select: { id: true, code: true, name: true, status: true, _count: { select: { snapshotItems: true } } },
    }),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = new Map<string, CategoryDatum>();
  const statusCounts: Record<AssetStatusValue, number> = { IN_SERVICE: 0, IN_STOCK: 0, UNDER_MAINTENANCE: 0, DISPOSED: 0, MISSING: 0 };
  const nbvById = new Map<string, number>();
  let gross = 0;
  let nbv = 0;
  let untagged = 0;
  let activeCount = 0;

  for (const a of assets) {
    statusCounts[a.status] += 1;
    if (a.status === "DISPOSED") continue;
    activeCount += 1;
    const value = Number(a.acquisitionValue);
    const dep = assetDepreciation(a, now, company.fiscalYearStartMonth);
    nbvById.set(a.id, dep.netBookValue);
    gross += value;
    nbv += dep.netBookValue;
    if (a.tagStatus === "UNTAGGED") untagged += 1;
    const key = a.categoryId;
    const bucket = byCategory.get(key) ?? { name: categoryName.get(key) ?? "—", count: 0, gross: 0, nbv: 0 };
    bucket.count += 1;
    bucket.gross = round2(bucket.gross + value);
    bucket.nbv = round2(bucket.nbv + dep.netBookValue);
    byCategory.set(key, bucket);
  }

  // Missing assets: register status MISSING + open "manquants" of the latest campaign.
  const missingIds = new Set(assets.filter((a) => a.status === "MISSING").map((a) => a.id));
  let reconciliation: { rate: number; expected: number; found: number; campaign: { id: string; code: string; name: string } } | null = null;
  let progressBySite: ProgressDatum[] = [];
  let progressByFloor: ProgressDatum[] = [];

  if (latestCampaign) {
    const [progress, openMissing] = await Promise.all([
      computeCampaignProgress(company.id, latestCampaign.id),
      prisma.reconciliationResult.findMany({
        where: { campaignId: latestCampaign.id, category: "MISSING", resolution: "OPEN" },
        select: { assetId: true },
      }),
    ]);
    for (const m of openMissing) if (m.assetId) missingIds.add(m.assetId);
    reconciliation = {
      rate: progress.expected ? progress.found / progress.expected : 0,
      expected: progress.expected,
      found: progress.found,
      campaign: { id: latestCampaign.id, code: latestCampaign.code, name: latestCampaign.name },
    };
    progressBySite = progress.bySite;
    progressByFloor = progress.byFloor;
  }

  let missingValue = 0;
  for (const id of missingIds) missingValue += nbvById.get(id) ?? 0;

  // CapEx: last 12 months of acquisitions (disposed assets included — they were acquisitions).
  const months: { key: string; label: string; value: number; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: formatMonthLabel(d.getUTCFullYear(), d.getUTCMonth()), value: 0, count: 0 });
  }
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const a of assets) {
    const k = `${a.acquisitionDate.getUTCFullYear()}-${a.acquisitionDate.getUTCMonth()}`;
    const idx = monthIndex.get(k);
    if (idx === undefined) continue;
    months[idx].value = round2(months[idx].value + Number(a.acquisitionValue));
    months[idx].count += 1;
  }

  return {
    totals: { gross: round2(gross), nbv: round2(nbv), activeCount, untagged, missingValue: round2(missingValue), missingCount: missingIds.size, pendingInvoices },
    statusCounts,
    categories: [...byCategory.values()].sort((a, b) => b.gross - a.gross),
    capex: months.map(({ label, value, count }) => ({ label, value, count })),
    reconciliation,
    progressBySite,
    progressByFloor,
    recentEvents,
    activeCampaigns,
  };
}
