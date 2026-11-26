"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ReconciliationCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { integrateSurplusSchema } from "@/lib/validators";
import { clientIp, requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { assertCompanyRefs, getCompanyCampaignOrThrow } from "@/lib/server/guards";
import { recordEvents, type AssetEventInput } from "@/lib/server/audit";
import { nextAssetCodes } from "@/lib/server/sequences";
import { computeAndStoreReconciliation } from "@/lib/server/reconciliation-service";

const bulkSchema = z.object({
  campaignId: z.string().min(1).max(64),
  resultIds: z.array(z.string().min(1).max(64)).min(1, "Sélectionnez au moins une ligne").max(10000),
  note: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
});

function refresh(campaignId: string) {
  revalidatePath(`/campaigns/${campaignId}/reconcile`);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/assets");
  revalidatePath("/dashboard");
}

async function loadForResolution(companyId: string, campaignId: string, resultIds: string[], categories: ReconciliationCategory[]) {
  const campaign = await getCompanyCampaignOrThrow(companyId, campaignId);
  if (campaign.status !== "COUNT_CLOSED") {
    throw new AppError(
      campaign.status === "VALIDATED"
        ? "Campagne validée : les régularisations sont verrouillées."
        : "Clôturez d'abord le comptage pour appliquer des régularisations.",
    );
  }
  const results = await prisma.reconciliationResult.findMany({
    where: { campaignId, id: { in: resultIds }, category: { in: categories } },
  });
  if (!results.length) throw new AppError("Aucune ligne éligible dans la sélection.");
  return { campaign, results };
}

/** Recomputes the 4-way classification (allowed until the PV is validated). */
export async function runReconciliation(campaignId: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("campaign:manage");
    const campaign = await getCompanyCampaignOrThrow(company.id, campaignId);
    if (campaign.status === "DRAFT") throw new AppError("La campagne n'est pas lancée.");
    if (campaign.status === "VALIDATED") throw new AppError("Campagne validée : rapprochement figé.");
    const { count } = await computeAndStoreReconciliation(campaign.id, company.id);
    refresh(campaign.id);
    return { count };
  }, "Rapprochement recalculé.");
}

/** Déplacés → aligns the accounting location (and status) on the physical reality. */
export async function syncLocations(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("reconcile:resolve");
    const data = bulkSchema.parse(input);
    const { campaign, results } = await loadForResolution(company.id, data.campaignId, data.resultIds, ["MISPLACED"]);
    const eligible = results.filter((r) => r.assetId && r.foundLocationId && r.resolution === "OPEN");
    if (!eligible.length) throw new AppError("Les lignes sélectionnées sont déjà régularisées.");
    const assets = await prisma.asset.findMany({
      where: { companyId: company.id, id: { in: eligible.map((r) => r.assetId!) } },
      select: { id: true, locationId: true, status: true },
    });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const ip = await clientIp();
    const now = new Date();
    await prisma.$transaction(
      async (tx) => {
        const events: AssetEventInput[] = [];
        for (const r of eligible) {
          const asset = assetById.get(r.assetId!);
          if (!asset || asset.status === "DISPOSED") continue;
          const restoreStatus = asset.status === "MISSING";
          await tx.asset.update({
            where: { id: asset.id },
            data: { locationId: r.foundLocationId, ...(restoreStatus ? { status: "IN_SERVICE" } : {}) },
          });
          if (asset.locationId !== r.foundLocationId) {
            events.push({
              companyId: company.id,
              assetId: asset.id,
              type: "LOCATION_TRANSFER",
              summary: `Régularisation inventaire ${campaign.code} : localisation alignée sur le constat physique (${r.foundLocationPath ?? ""})`,
              fromLocationId: asset.locationId,
              toLocationId: r.foundLocationId,
              campaignId: campaign.id,
              userId: user.id,
              ipAddress: ip,
            });
          }
          if (restoreStatus) {
            events.push({
              companyId: company.id,
              assetId: asset.id,
              type: "STATUS_CHANGE",
              summary: `Régularisation inventaire ${campaign.code} : bien retrouvé, remis en service`,
              fromStatus: "MISSING",
              toStatus: "IN_SERVICE",
              campaignId: campaign.id,
              userId: user.id,
              ipAddress: ip,
            });
          }
        }
        await recordEvents(tx, events);
        await tx.reconciliationResult.updateMany({
          where: { id: { in: eligible.map((r) => r.id) } },
          data: {
            resolution: "RESOLVED",
            resolutionAction: "LOCATION_SYNCED",
            resolutionNote: data.note,
            resolvedById: user.id,
            resolvedAt: now,
          },
        });
      },
      { timeout: 60_000 },
    );
    refresh(campaign.id);
    return { count: eligible.length };
  }, "Localisations comptables synchronisées avec le constat physique.");
}

/** Manquants → declares the assets as missing (écart négatif) in the register. */
export async function declareMissing(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("reconcile:resolve");
    const data = bulkSchema.parse(input);
    const { campaign, results } = await loadForResolution(company.id, data.campaignId, data.resultIds, ["MISSING"]);
    const eligible = results.filter((r) => r.assetId && r.resolution === "OPEN");
    if (!eligible.length) throw new AppError("Les lignes sélectionnées sont déjà traitées.");
    const assets = await prisma.asset.findMany({
      where: { companyId: company.id, id: { in: eligible.map((r) => r.assetId!) }, status: { not: "DISPOSED" } },
      select: { id: true, status: true },
    });
    const ip = await clientIp();
    await prisma.$transaction(
      async (tx) => {
        const changing = assets.filter((a) => a.status !== "MISSING");
        await tx.asset.updateMany({ where: { id: { in: changing.map((a) => a.id) } }, data: { status: "MISSING" } });
        await recordEvents(
          tx,
          changing.map((a) => ({
            companyId: company.id,
            assetId: a.id,
            type: "STATUS_CHANGE" as const,
            summary: `Inventaire ${campaign.code} : bien non retrouvé, déclaré disparu (écart négatif)${data.note ? ` — ${data.note}` : ""}`,
            fromStatus: a.status,
            toStatus: "MISSING" as const,
            campaignId: campaign.id,
            userId: user.id,
            ipAddress: ip,
          })),
        );
        await tx.reconciliationResult.updateMany({
          where: { id: { in: eligible.map((r) => r.id) } },
          data: {
            resolution: "RESOLVED",
            resolutionAction: "DECLARED_MISSING",
            resolutionNote: data.note,
            resolvedById: user.id,
            resolvedAt: new Date(),
          },
        });
      },
      { timeout: 60_000 },
    );
    refresh(campaign.id);
    return { count: eligible.length };
  }, "Biens déclarés disparus.");
}

/** Damaged / to-repair assets found during the count → status "En maintenance". */
export async function sendToMaintenance(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("reconcile:resolve");
    const data = bulkSchema.parse(input);
    const { campaign, results } = await loadForResolution(company.id, data.campaignId, data.resultIds, ["MATCH", "MISPLACED"]);
    const eligible = results.filter((r) => r.assetId && (r.condition === "DAMAGED" || r.condition === "TO_REPAIR"));
    if (!eligible.length) throw new AppError("Aucun bien endommagé ou à réparer dans la sélection.");
    const assets = await prisma.asset.findMany({
      where: { companyId: company.id, id: { in: eligible.map((r) => r.assetId!) }, status: { notIn: ["DISPOSED", "UNDER_MAINTENANCE"] } },
      select: { id: true, status: true },
    });
    const ip = await clientIp();
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({ where: { id: { in: assets.map((a) => a.id) } }, data: { status: "UNDER_MAINTENANCE" } });
      await recordEvents(
        tx,
        assets.map((a) => ({
          companyId: company.id,
          assetId: a.id,
          type: "STATUS_CHANGE" as const,
          summary: `Inventaire ${campaign.code} : état dégradé constaté, envoi en maintenance${data.note ? ` — ${data.note}` : ""}`,
          fromStatus: a.status,
          toStatus: "UNDER_MAINTENANCE" as const,
          campaignId: campaign.id,
          userId: user.id,
          ipAddress: ip,
        })),
      );
    });
    refresh(campaign.id);
    return { count: assets.length };
  }, "Biens passés en maintenance.");
}

const justifySchema = bulkSchema.extend({
  resolution: z.enum(["RESOLVED", "IGNORED"]),
  note: z.string().trim().min(3, "Justification obligatoire").max(1000),
});

/** Documents a discrepancy without changing the register (e.g. asset at a repairer, third-party asset). */
export async function justifyResults(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("reconcile:resolve");
    const data = justifySchema.parse(input);
    const { campaign, results } = await loadForResolution(company.id, data.campaignId, data.resultIds, ["MISPLACED", "MISSING", "SURPLUS"]);
    await prisma.$transaction(async (tx) => {
      await tx.reconciliationResult.updateMany({
        where: { id: { in: results.map((r) => r.id) } },
        data: {
          resolution: data.resolution,
          resolutionAction: "JUSTIFIED",
          resolutionNote: data.note,
          resolvedById: user.id,
          resolvedAt: new Date(),
        },
      });
      const surplusIds = results.map((r) => r.surplusId).filter((v): v is string => !!v);
      if (surplusIds.length && data.resolution === "IGNORED") {
        await tx.campaignSurplus.updateMany({
          where: { id: { in: surplusIds }, status: "PENDING" },
          data: { status: "REJECTED", resolutionNote: data.note, resolvedById: user.id, resolvedAt: new Date() },
        });
      }
    });
    refresh(campaign.id);
    return { count: results.length };
  }, "Justification enregistrée.");
}

/** Surplus → creates a proper asset card from an item found on site. */
export async function integrateSurplus(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("reconcile:resolve");
    const data = integrateSurplusSchema.parse(input);
    await assertCompanyRefs(company.id, { categoryId: data.categoryId });
    const { campaign, results } = await loadForResolution(company.id, data.campaignId, [data.resultId], ["SURPLUS"]);
    const result = results[0];
    if (!result.surplusId) throw new AppError("Cette ligne ne correspond pas à un excédent saisi sur le terrain.");
    const surplus = await prisma.campaignSurplus.findUniqueOrThrow({ where: { id: result.surplusId } });
    if (surplus.status !== "PENDING") throw new AppError("Cet excédent est déjà traité.");
    const category = await prisma.assetCategory.findUniqueOrThrow({ where: { id: data.categoryId } });
    const ip = await clientIp();
    const asset = await prisma.$transaction(async (tx) => {
      const [code] = await nextAssetCodes(tx, company.id, 1);
      const created = await tx.asset.create({
        data: {
          companyId: company.id,
          code,
          designation: data.designation,
          description: surplus.description,
          brand: data.brand,
          model: data.model,
          serialNumber: data.serialNumber,
          categoryId: category.id,
          acquisitionDate: data.acquisitionDate,
          commissioningDate: data.acquisitionDate,
          acquisitionValue: data.acquisitionValue,
          depreciationMethod: category.defaultMethod,
          usefulLifeYears: category.defaultUsefulLifeYears,
          decliningCoefficient: category.defaultMethod === "DECLINING" ? category.decliningCoefficient : null,
          status: "IN_SERVICE",
          condition: surplus.condition,
          origin: "SURPLUS",
          locationId: surplus.locationId,
          photoKey: surplus.photoKey,
          lastSeenAt: surplus.foundAt,
          notes: [`Excédent d'inventaire ${campaign.code} — étiquette provisoire ${surplus.tempTag}`, data.note].filter(Boolean).join("\n"),
          createdById: user.id,
        },
      });
      await tx.campaignSurplus.update({
        where: { id: surplus.id },
        data: { status: "INTEGRATED", resolvedAssetId: created.id, resolvedById: user.id, resolvedAt: new Date(), resolutionNote: data.note },
      });
      await tx.reconciliationResult.update({
        where: { id: result.id },
        data: {
          resolution: "RESOLVED",
          resolutionAction: "INTEGRATED",
          resolutionNote: data.note ?? `Intégré sous le code ${code}`,
          resolvedById: user.id,
          resolvedAt: new Date(),
        },
      });
      await recordEvents(tx, [
        {
          companyId: company.id,
          assetId: created.id,
          type: "CREATED",
          summary: `Intégration d'un excédent d'inventaire (${surplus.tempTag}, campagne ${campaign.code})`,
          toLocationId: surplus.locationId,
          toStatus: "IN_SERVICE",
          campaignId: campaign.id,
          data: { surplusId: surplus.id, tempTag: surplus.tempTag },
          userId: user.id,
          ipAddress: ip,
        },
      ]);
      return created;
    });
    refresh(campaign.id);
    return { assetId: asset.id, code: asset.code };
  }, "Excédent intégré à l'actif.");
}
