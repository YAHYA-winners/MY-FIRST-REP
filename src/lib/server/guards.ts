import "server-only";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";

interface RefIds {
  categoryId?: string | null;
  categoryIds?: string[];
  locationId?: string | null;
  locationIds?: string[];
  departmentId?: string | null;
  costCenterId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
}

/**
 * Guarantees that every referenced id belongs to the active company
 * (prevents cross-entity data tampering through forged ids).
 */
export async function assertCompanyRefs(companyId: string, refs: RefIds): Promise<void> {
  const checks: Promise<void>[] = [];
  const categoryIds = [...new Set([...(refs.categoryIds ?? []), ...(refs.categoryId ? [refs.categoryId] : [])])];
  const locationIds = [...new Set([...(refs.locationIds ?? []), ...(refs.locationId ? [refs.locationId] : [])])];

  if (categoryIds.length) {
    checks.push(
      prisma.assetCategory.count({ where: { companyId, id: { in: categoryIds } } }).then((n) => {
        if (n !== categoryIds.length) throw new AppError("Catégorie comptable invalide.", 400);
      }),
    );
  }
  if (locationIds.length) {
    checks.push(
      prisma.location.count({ where: { companyId, id: { in: locationIds } } }).then((n) => {
        if (n !== locationIds.length) throw new AppError("Localisation invalide.", 400);
      }),
    );
  }
  if (refs.departmentId) {
    checks.push(
      prisma.department.count({ where: { companyId, id: refs.departmentId } }).then((n) => {
        if (!n) throw new AppError("Direction / service invalide.", 400);
      }),
    );
  }
  if (refs.costCenterId) {
    checks.push(
      prisma.costCenter.count({ where: { companyId, id: refs.costCenterId } }).then((n) => {
        if (!n) throw new AppError("Centre de coût invalide.", 400);
      }),
    );
  }
  if (refs.supplierId) {
    checks.push(
      prisma.supplier.count({ where: { companyId, id: refs.supplierId } }).then((n) => {
        if (!n) throw new AppError("Fournisseur invalide.", 400);
      }),
    );
  }
  if (refs.employeeId) {
    checks.push(
      prisma.employee.count({ where: { companyId, id: refs.employeeId, active: true } }).then((n) => {
        if (!n) throw new AppError("Collaborateur invalide ou inactif.", 400);
      }),
    );
  }
  await Promise.all(checks);
}

export async function getCompanyAssetOrThrow(companyId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, companyId } });
  if (!asset) throw new AppError("Immobilisation introuvable.", 404);
  return asset;
}

export async function getCompanyCampaignOrThrow(companyId: string, campaignId: string) {
  const campaign = await prisma.inventoryCampaign.findFirst({ where: { id: campaignId, companyId } });
  if (!campaign) throw new AppError("Campagne d'inventaire introuvable.", 404);
  return campaign;
}
