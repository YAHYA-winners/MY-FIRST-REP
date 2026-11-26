import "server-only";
import type { Company } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { summarizeReconciliation } from "@/lib/reconciliation";
import type { ReconciliationReport } from "@/lib/report-types";

export async function buildReconciliationReport(company: Company, campaignId: string): Promise<ReconciliationReport | null> {
  const campaign = await prisma.inventoryCampaign.findFirst({
    where: { id: campaignId, companyId: company.id },
    include: {
      createdBy: { select: { name: true } },
      validatedBy: { select: { name: true } },
      members: { include: { user: { select: { name: true } } } },
      scopeLocations: { include: { location: { select: { path: true } } } },
      scopeCategories: { include: { category: { select: { name: true } } } },
      _count: { select: { scans: true } },
    },
  });
  if (!campaign) return null;
  const results = await prisma.reconciliationResult.findMany({
    where: { campaignId },
    orderBy: [{ category: "asc" }, { assetCode: "asc" }],
    include: {
      resolvedBy: { select: { name: true } },
      scan: { select: { photoKey: true } },
      surplus: { select: { photoKey: true } },
    },
  });
  const rows = results.map((r) => ({
    id: r.id,
    category: r.category,
    assetId: r.assetId,
    surplusId: r.surplusId,
    assetCode: r.assetCode,
    designation: r.designation,
    categoryName: r.categoryName,
    serialNumber: r.serialNumber,
    expectedLocationPath: r.expectedLocationPath,
    foundLocationPath: r.foundLocationPath,
    expectedStatus: r.expectedStatus,
    condition: r.condition,
    grossValue: Number(r.grossValue),
    netBookValue: Number(r.netBookValue),
    reasons: r.reasons,
    resolution: r.resolution,
    resolutionAction: r.resolutionAction,
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy?.name ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    photoKey: r.scan?.photoKey ?? r.surplus?.photoKey ?? null,
  }));
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    generatedAt: new Date().toISOString(),
    company: {
      name: company.name,
      legalName: company.legalName,
      ice: company.ice,
      taxId: company.taxId,
      tradeRegister: company.tradeRegister,
      address: company.address,
      city: company.city,
      currency: company.currency,
    },
    campaign: {
      id: campaign.id,
      code: campaign.code,
      name: campaign.name,
      status: campaign.status,
      plannedStartDate: iso(campaign.plannedStartDate),
      plannedEndDate: iso(campaign.plannedEndDate),
      launchedAt: iso(campaign.launchedAt),
      countClosedAt: iso(campaign.countClosedAt),
      reconciledAt: iso(campaign.reconciledAt),
      validatedAt: iso(campaign.validatedAt),
      pvNumber: campaign.pvNumber,
      pvObservations: campaign.pvObservations,
      scope: campaign.scopeLocations.map((s) => s.location.path),
      categories: campaign.scopeCategories.map((s) => s.category.name),
      team: campaign.members.map((m) => ({ name: m.user.name, role: m.role })),
      createdBy: campaign.createdBy.name,
      validatedBy: campaign.validatedBy?.name ?? null,
      scansCount: campaign._count.scans,
    },
    summary: summarizeReconciliation(
      results.map((r) => ({
        category: r.category,
        grossValue: Number(r.grossValue),
        netBookValue: Number(r.netBookValue),
        snapshotItemId: r.snapshotItemId,
      })),
    ),
    rows,
  };
}
