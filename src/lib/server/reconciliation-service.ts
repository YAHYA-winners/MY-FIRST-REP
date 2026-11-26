import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assetDepreciation } from "@/lib/depreciation";
import { classifyReconciliation, type ClassifiedLine } from "@/lib/reconciliation";
import { locationPathMap } from "@/lib/server/locations";

/**
 * Recomputes the 4-way reconciliation of a campaign and stores it.
 * Resolutions already applied to an asset line (same asset, same category) are
 * carried over so that re-running never loses regularisation work; surplus lines
 * derive their resolution from the surplus status.
 */
export async function computeAndStoreReconciliation(campaignId: string, companyId: string) {
  const campaign = await prisma.inventoryCampaign.findFirstOrThrow({
    where: { id: campaignId, companyId },
    select: { id: true, launchedAt: true, company: { select: { fiscalYearStartMonth: true } } },
  });
  const asOf = campaign.launchedAt ?? new Date();

  const [snapshot, scans, surpluses, paths, previous] = await Promise.all([
    prisma.campaignSnapshotItem.findMany({ where: { campaignId } }),
    prisma.campaignScan.findMany({
      where: { campaignId },
      select: { id: true, assetId: true, locationId: true, condition: true, scannedAt: true, transferProposed: true },
    }),
    prisma.campaignSurplus.findMany({ where: { campaignId }, include: { category: { select: { name: true } } } }),
    locationPathMap(companyId),
    prisma.reconciliationResult.findMany({
      where: { campaignId },
      select: {
        category: true,
        assetId: true,
        resolution: true,
        resolutionAction: true,
        resolutionNote: true,
        resolvedById: true,
        resolvedAt: true,
      },
    }),
  ]);

  const snapshotIds = new Set(snapshot.map((s) => s.assetId));
  const extraIds = [...new Set(scans.map((s) => s.assetId).filter((id) => !snapshotIds.has(id)))];
  const extraAssets = extraIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: extraIds }, companyId },
        include: { category: { select: { name: true } }, location: { select: { path: true } } },
      })
    : [];

  const lines: ClassifiedLine[] = classifyReconciliation({
    snapshot: snapshot.map((s) => ({
      id: s.id,
      assetId: s.assetId,
      assetCode: s.assetCode,
      designation: s.designation,
      serialNumber: s.serialNumber,
      categoryName: s.categoryName,
      expectedLocationId: s.expectedLocationId,
      expectedLocationPath: s.expectedLocationPath,
      expectedStatus: s.expectedStatus,
      grossValue: Number(s.grossValue),
      netBookValue: Number(s.netBookValue),
    })),
    scans,
    extraAssets: extraAssets.map((a) => {
      const dep = assetDepreciation(a, asOf, campaign.company.fiscalYearStartMonth);
      return {
        assetId: a.id,
        assetCode: a.code,
        designation: a.designation,
        serialNumber: a.serialNumber,
        categoryName: a.category.name,
        status: a.status,
        locationId: a.locationId,
        locationPath: a.location?.path ?? null,
        grossValue: Number(a.acquisitionValue),
        netBookValue: dep.netBookValue,
      };
    }),
    surpluses: surpluses.map((s) => ({
      id: s.id,
      tempTag: s.tempTag,
      designation: s.designation,
      serialNumber: s.serialNumber,
      categoryName: s.category?.name ?? null,
      locationId: s.locationId,
      condition: s.condition,
      estimatedValue: s.estimatedValue ? Number(s.estimatedValue) : 0,
      status: s.status,
      scannedCode: s.scannedCode,
    })),
    locationPaths: paths,
  });

  const previousByAsset = new Map(previous.filter((p) => p.assetId).map((p) => [`${p.assetId}:${p.category}`, p]));
  const surplusById = new Map(surpluses.map((s) => [s.id, s]));
  const now = new Date();

  const rows: Prisma.ReconciliationResultCreateManyInput[] = lines.map((line) => {
    let resolution: Prisma.ReconciliationResultCreateManyInput["resolution"] = "OPEN";
    let resolutionAction: string | null = null;
    let resolutionNote: string | null = null;
    let resolvedById: string | null = null;
    let resolvedAt: Date | null = null;

    if (line.category === "MATCH") {
      resolution = "RESOLVED";
      resolutionAction = "CONFORME";
      resolvedAt = now;
    }
    const prev = line.assetId ? previousByAsset.get(`${line.assetId}:${line.category}`) : undefined;
    if (prev && prev.resolution !== "OPEN" && line.category !== "MATCH") {
      resolution = prev.resolution;
      resolutionAction = prev.resolutionAction;
      resolutionNote = prev.resolutionNote;
      resolvedById = prev.resolvedById;
      resolvedAt = prev.resolvedAt;
    }
    if (line.surplusId) {
      const s = surplusById.get(line.surplusId);
      if (s?.status === "INTEGRATED") {
        resolution = "RESOLVED";
        resolutionAction = "INTEGRATED";
        resolutionNote = s.resolutionNote;
        resolvedById = s.resolvedById;
        resolvedAt = s.resolvedAt;
      } else if (s?.status === "REJECTED") {
        resolution = "IGNORED";
        resolutionAction = "REJECTED";
        resolutionNote = s.resolutionNote;
        resolvedById = s.resolvedById;
        resolvedAt = s.resolvedAt;
      }
    }
    return {
      campaignId,
      category: line.category,
      assetId: line.assetId,
      snapshotItemId: line.snapshotItemId,
      scanId: line.scanId,
      surplusId: line.surplusId,
      assetCode: line.assetCode,
      designation: line.designation,
      categoryName: line.categoryName,
      serialNumber: line.serialNumber,
      expectedLocationId: line.expectedLocationId,
      expectedLocationPath: line.expectedLocationPath,
      foundLocationId: line.foundLocationId,
      foundLocationPath: line.foundLocationPath,
      expectedStatus: line.expectedStatus,
      condition: line.condition,
      grossValue: line.grossValue,
      netBookValue: line.netBookValue,
      reasons: line.reasons,
      resolution,
      resolutionAction,
      resolutionNote,
      resolvedById,
      resolvedAt,
    };
  });

  await prisma.$transaction(
    async (tx) => {
      await tx.reconciliationResult.deleteMany({ where: { campaignId } });
      for (let i = 0; i < rows.length; i += 1000) {
        await tx.reconciliationResult.createMany({ data: rows.slice(i, i + 1000) });
      }
      await tx.inventoryCampaign.update({ where: { id: campaignId }, data: { reconciledAt: now } });
    },
    { timeout: 60_000 },
  );

  return { count: rows.length };
}
