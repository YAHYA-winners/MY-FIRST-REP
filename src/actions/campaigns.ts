"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { assetDepreciation } from "@/lib/depreciation";
import { campaignSchema, type CampaignInput } from "@/lib/validators";
import { requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { assertCompanyRefs, getCompanyCampaignOrThrow } from "@/lib/server/guards";
import { expandLocationSubtrees } from "@/lib/server/locations";
import { nextCampaignCode, nextPvNumber } from "@/lib/server/sequences";
import { computeAndStoreReconciliation } from "@/lib/server/reconciliation-service";

async function scopeWhere(companyId: string, locationIds: string[], categoryIds: string[]): Promise<Prisma.AssetWhereInput> {
  const where: Prisma.AssetWhereInput = {
    companyId,
    status: { not: "DISPOSED" },
    category: { trackPhysically: true },
  };
  if (locationIds.length) {
    const expanded = await expandLocationSubtrees(companyId, locationIds);
    where.locationId = { in: expanded };
  }
  if (categoryIds.length) where.categoryId = { in: categoryIds };
  return where;
}

export async function previewCampaignScope(input: { locationIds: string[]; categoryIds: string[] }) {
  return runAction(async () => {
    const { company } = await requireActionContext("campaign:manage");
    const locationIds = Array.isArray(input.locationIds) ? input.locationIds.slice(0, 500) : [];
    const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.slice(0, 200) : [];
    const where = await scopeWhere(company.id, locationIds, categoryIds);
    const agg = await prisma.asset.aggregate({ where, _count: { _all: true }, _sum: { acquisitionValue: true } });
    return { count: agg._count._all, grossValue: Number(agg._sum.acquisitionValue ?? 0) };
  });
}

export async function createCampaign(input: CampaignInput) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("campaign:manage");
    const data = campaignSchema.parse(input);
    await assertCompanyRefs(company.id, { locationIds: data.locationIds, categoryIds: data.categoryIds });
    const memberIds = [...new Set([...data.memberIds, ...(data.leadId ? [data.leadId] : [])])];
    if (memberIds.length) {
      const members = await prisma.userCompany.count({ where: { companyId: company.id, userId: { in: memberIds } } });
      if (members !== memberIds.length) throw new AppError("Membre d'équipe invalide.");
    }
    const campaign = await prisma.$transaction(async (tx) => {
      const code = await nextCampaignCode(tx, company.id);
      return tx.inventoryCampaign.create({
        data: {
          companyId: company.id,
          code,
          name: data.name,
          description: data.description,
          plannedStartDate: data.plannedStartDate,
          plannedEndDate: data.plannedEndDate,
          createdById: user.id,
          scopeLocations: { create: data.locationIds.map((locationId) => ({ locationId })) },
          scopeCategories: { create: data.categoryIds.map((categoryId) => ({ categoryId })) },
          members: {
            create: memberIds.map((userId) => ({ userId, role: userId === data.leadId ? "LEAD" : "COUNTER" })),
          },
        },
      });
    });
    revalidatePath("/campaigns");
    return { id: campaign.id, code: campaign.code };
  }, "Campagne créée.");
}

export async function deleteCampaign(campaignId: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("campaign:manage");
    const campaign = await getCompanyCampaignOrThrow(company.id, campaignId);
    if (campaign.status !== "DRAFT") throw new AppError("Seule une campagne en préparation peut être supprimée.");
    await prisma.inventoryCampaign.delete({ where: { id: campaign.id } });
    revalidatePath("/campaigns");
    return null;
  }, "Campagne supprimée.");
}

/** Launch: freezes the theoretical accounting register (snapshot) and opens counting. */
export async function launchCampaign(campaignId: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("campaign:manage");
    const campaign = await prisma.inventoryCampaign.findFirst({
      where: { id: campaignId, companyId: company.id },
      include: { scopeLocations: true, scopeCategories: true },
    });
    if (!campaign) throw new AppError("Campagne introuvable.", 404);
    if (campaign.status !== "DRAFT") throw new AppError("Campagne déjà lancée.");
    const where = await scopeWhere(
      company.id,
      campaign.scopeLocations.map((s) => s.locationId),
      campaign.scopeCategories.map((s) => s.categoryId),
    );
    const assets = await prisma.asset.findMany({
      where,
      include: {
        category: { select: { name: true } },
        location: { select: { path: true } },
        custodian: { select: { firstName: true, lastName: true } },
      },
    });
    if (assets.length === 0) throw new AppError("Aucun bien dans le périmètre : élargissez la sélection avant de lancer.");
    const now = new Date();
    const rows: Prisma.CampaignSnapshotItemCreateManyInput[] = assets.map((a) => {
      const dep = assetDepreciation(a, now, company.fiscalYearStartMonth);
      return {
        campaignId: campaign.id,
        assetId: a.id,
        assetCode: a.code,
        designation: a.designation,
        serialNumber: a.serialNumber,
        categoryId: a.categoryId,
        categoryName: a.category.name,
        expectedLocationId: a.locationId,
        expectedLocationPath: a.location?.path ?? null,
        expectedCustodianName: a.custodian ? `${a.custodian.firstName} ${a.custodian.lastName}` : null,
        expectedStatus: a.status,
        acquisitionDate: a.acquisitionDate,
        grossValue: a.acquisitionValue,
        accumulatedDepreciation: dep.accumulated,
        netBookValue: dep.netBookValue,
      };
    });
    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < rows.length; i += 1000) {
          await tx.campaignSnapshotItem.createMany({ data: rows.slice(i, i + 1000) });
        }
        await tx.inventoryCampaign.update({
          where: { id: campaign.id },
          data: { status: "IN_PROGRESS", launchedAt: now, plannedStartDate: campaign.plannedStartDate ?? now },
        });
      },
      { timeout: 120_000 },
    );
    revalidatePath(`/campaigns/${campaign.id}`);
    revalidatePath("/campaigns");
    return { snapshotCount: rows.length };
  }, "Campagne lancée : fichier comptable théorique figé.");
}

export async function closeCount(campaignId: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("campaign:manage");
    const campaign = await getCompanyCampaignOrThrow(company.id, campaignId);
    if (campaign.status !== "IN_PROGRESS") throw new AppError("Le comptage n'est pas en cours.");
    await prisma.inventoryCampaign.update({
      where: { id: campaign.id },
      data: { status: "COUNT_CLOSED", countClosedAt: new Date() },
    });
    await computeAndStoreReconciliation(campaign.id, company.id);
    revalidatePath(`/campaigns/${campaign.id}`);
    revalidatePath(`/campaigns/${campaign.id}/reconcile`);
    revalidatePath("/campaigns");
    return null;
  }, "Comptage clôturé, rapprochement calculé.");
}

export async function reopenCount(campaignId: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("campaign:manage");
    const campaign = await getCompanyCampaignOrThrow(company.id, campaignId);
    if (campaign.status !== "COUNT_CLOSED") throw new AppError("Le comptage n'est pas clôturé.");
    const applied = await prisma.reconciliationResult.count({
      where: { campaignId, resolution: { not: "OPEN" }, category: { not: "MATCH" } },
    });
    if (applied) throw new AppError("Des régularisations ont déjà été appliquées : réouverture impossible.");
    await prisma.inventoryCampaign.update({ where: { id: campaign.id }, data: { status: "IN_PROGRESS", countClosedAt: null } });
    revalidatePath(`/campaigns/${campaign.id}`);
    return null;
  }, "Comptage réouvert.");
}

export async function validateCampaign(campaignId: string, observations: string) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("campaign:validate");
    const campaign = await getCompanyCampaignOrThrow(company.id, campaignId);
    if (campaign.status !== "COUNT_CLOSED") throw new AppError("Clôturez le comptage avant de valider le PV.");
    if (!campaign.reconciledAt) await computeAndStoreReconciliation(campaign.id, company.id);
    const updated = await prisma.$transaction(async (tx) => {
      const pvNumber = await nextPvNumber(tx, company.id);
      return tx.inventoryCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "VALIDATED",
          validatedAt: new Date(),
          validatedById: user.id,
          pvNumber,
          pvObservations: (observations ?? "").trim().slice(0, 4000) || null,
        },
      });
    });
    revalidatePath(`/campaigns/${campaign.id}`);
    revalidatePath(`/campaigns/${campaign.id}/reconcile`);
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    return { pvNumber: updated.pvNumber };
  }, "Procès-verbal validé : campagne verrouillée.");
}
