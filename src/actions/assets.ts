"use server";

import { revalidatePath } from "next/cache";
import type { Asset, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { round2 } from "@/lib/utils";
import { assetDepreciation, computeDepreciation, toDepreciationInput } from "@/lib/depreciation";
import {
  assetSchema,
  assignmentSchema,
  disposalSchema,
  importRowSchema,
  returnSchema,
  statusChangeSchema,
  transferSchema,
  type AssetInput,
  type ImportRowInput,
} from "@/lib/validators";
import { ASSET_STATUS_LABELS, ASSET_CONDITION_LABELS, DISPOSAL_TYPE_LABELS } from "@/lib/constants";
import { clientIp, requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { assertCompanyRefs, getCompanyAssetOrThrow } from "@/lib/server/guards";
import { nextAssetCodes } from "@/lib/server/sequences";
import { recordEvents, type AssetEventInput } from "@/lib/server/audit";
import { buildStorageKey, putObject } from "@/lib/server/storage";
import { formatDate } from "@/lib/format";

function assetData(data: ReturnType<typeof assetSchema.parse>) {
  return {
    designation: data.designation,
    description: data.description,
    brand: data.brand,
    model: data.model,
    serialNumber: data.serialNumber,
    quantity: data.quantity,
    categoryId: data.categoryId,
    supplierId: data.supplierId,
    acquisitionDate: data.acquisitionDate,
    commissioningDate: data.commissioningDate,
    acquisitionValue: data.acquisitionValue,
    vatRate: data.vatRate,
    depreciationMethod: data.depreciationMethod,
    usefulLifeYears: data.depreciationMethod === "NONE" ? 0 : data.usefulLifeYears,
    decliningCoefficient: data.depreciationMethod === "DECLINING" ? data.decliningCoefficient : null,
    residualValue: data.residualValue,
    status: data.status,
    condition: data.condition,
    locationId: data.locationId,
    departmentId: data.departmentId,
    costCenterId: data.costCenterId,
    warrantyEndDate: data.warrantyEndDate,
    notes: data.notes,
  } satisfies Partial<Prisma.AssetUncheckedCreateInput>;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createAsset(input: AssetInput) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:write");
    const data = assetSchema.parse(input);
    await assertCompanyRefs(company.id, data);
    const asset = await prisma.$transaction(async (tx) => {
      const [code] = await nextAssetCodes(tx, company.id, 1);
      const created = await tx.asset.create({
        data: { ...assetData(data), companyId: company.id, code, origin: "MANUAL", createdById: user.id },
      });
      await recordEvents(tx, [
        {
          companyId: company.id,
          assetId: created.id,
          type: "CREATED",
          summary: `Création manuelle de la fiche ${code}`,
          toLocationId: created.locationId,
          toStatus: created.status,
          userId: user.id,
          ipAddress: await clientIp(),
        },
      ]);
      return created;
    });
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return { id: asset.id, code: asset.code };
  }, "Immobilisation créée.");
}

const TRACKED_FIELDS = [
  "designation",
  "description",
  "brand",
  "model",
  "serialNumber",
  "quantity",
  "categoryId",
  "supplierId",
  "acquisitionDate",
  "commissioningDate",
  "acquisitionValue",
  "vatRate",
  "depreciationMethod",
  "usefulLifeYears",
  "decliningCoefficient",
  "residualValue",
  "condition",
  "departmentId",
  "costCenterId",
  "warrantyEndDate",
  "notes",
] as const;

function normalizeForDiff(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && value !== null && "toNumber" in value) return Number(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return String(value);
}

export async function updateAsset(assetId: string, input: AssetInput) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:write");
    const current = await getCompanyAssetOrThrow(company.id, assetId);
    if (current.status === "DISPOSED") throw new AppError("Un bien sorti de l'actif ne peut plus être modifié.");
    const data = assetSchema.parse(input);
    await assertCompanyRefs(company.id, data);
    const next = assetData(data);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of TRACKED_FIELDS) {
      const before = normalizeForDiff(current[field as keyof Asset]);
      const after = normalizeForDiff(next[field as keyof typeof next]);
      if (before !== after) changes[field] = { from: before, to: after };
    }
    const ip = await clientIp();
    const events: AssetEventInput[] = [];
    if (Object.keys(changes).length) {
      events.push({
        companyId: company.id,
        assetId,
        type: "UPDATED",
        summary: `Modification de la fiche (${Object.keys(changes).length} champ(s))`,
        data: changes as Prisma.InputJsonValue,
        userId: user.id,
        ipAddress: ip,
      });
    }
    if (current.locationId !== next.locationId) {
      events.push({
        companyId: company.id,
        assetId,
        type: "LOCATION_TRANSFER",
        summary: "Transfert de localisation (modification de fiche)",
        fromLocationId: current.locationId,
        toLocationId: next.locationId,
        userId: user.id,
        ipAddress: ip,
      });
    }
    if (current.status !== next.status) {
      events.push({
        companyId: company.id,
        assetId,
        type: "STATUS_CHANGE",
        summary: `Statut : ${ASSET_STATUS_LABELS[current.status]} → ${ASSET_STATUS_LABELS[next.status]}`,
        fromStatus: current.status,
        toStatus: next.status,
        userId: user.id,
        ipAddress: ip,
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id: assetId }, data: next });
      await recordEvents(tx, events);
    });
    revalidatePath(`/assets/${assetId}`);
    revalidatePath("/assets");
    return { id: assetId };
  }, "Fiche mise à jour.");
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export async function transferAssets(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:transfer");
    const data = transferSchema.parse(input);
    await assertCompanyRefs(company.id, {
      locationId: data.locationId,
      departmentId: data.departmentId,
      costCenterId: data.costCenterId,
    });
    const assets = await prisma.asset.findMany({
      where: { companyId: company.id, id: { in: data.assetIds }, status: { not: "DISPOSED" } },
      select: { id: true, locationId: true },
    });
    if (assets.length === 0) throw new AppError("Aucun bien transférable sélectionné.");
    const destination = await prisma.location.findUniqueOrThrow({ where: { id: data.locationId }, select: { path: true } });
    const ip = await clientIp();
    const moving = assets.filter((a) => a.locationId !== data.locationId);
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: assets.map((a) => a.id) } },
        data: {
          locationId: data.locationId,
          ...(data.departmentId ? { departmentId: data.departmentId } : {}),
          ...(data.costCenterId ? { costCenterId: data.costCenterId } : {}),
        },
      });
      await recordEvents(
        tx,
        moving.map((a) => ({
          companyId: company.id,
          assetId: a.id,
          type: "LOCATION_TRANSFER" as const,
          summary: `Transfert vers ${destination.path}${data.reason ? ` — ${data.reason}` : ""}`,
          fromLocationId: a.locationId,
          toLocationId: data.locationId,
          userId: user.id,
          ipAddress: ip,
        })),
      );
    });
    revalidatePath("/assets");
    for (const a of assets) revalidatePath(`/assets/${a.id}`);
    return { count: moving.length };
  }, "Transfert enregistré.");
}

export async function changeAssetStatus(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:write");
    const data = statusChangeSchema.parse(input);
    const asset = await getCompanyAssetOrThrow(company.id, data.assetId);
    if (asset.status === "DISPOSED") throw new AppError("Ce bien est sorti de l'actif.");
    const ip = await clientIp();
    const events: AssetEventInput[] = [];
    if (asset.status !== data.status) {
      events.push({
        companyId: company.id,
        assetId: asset.id,
        type: "STATUS_CHANGE",
        summary: `Statut : ${ASSET_STATUS_LABELS[asset.status]} → ${ASSET_STATUS_LABELS[data.status]} — ${data.reason}`,
        fromStatus: asset.status,
        toStatus: data.status,
        userId: user.id,
        ipAddress: ip,
      });
    }
    if (data.condition && data.condition !== asset.condition) {
      events.push({
        companyId: company.id,
        assetId: asset.id,
        type: "CONDITION_CHANGE",
        summary: `État : ${ASSET_CONDITION_LABELS[asset.condition]} → ${ASSET_CONDITION_LABELS[data.condition]}`,
        data: { from: asset.condition, to: data.condition, reason: data.reason },
        userId: user.id,
        ipAddress: ip,
      });
    }
    if (!events.length) throw new AppError("Aucun changement à enregistrer.");
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: asset.id },
        data: { status: data.status, ...(data.condition ? { condition: data.condition } : {}) },
      });
      await recordEvents(tx, events);
    });
    revalidatePath(`/assets/${asset.id}`);
    revalidatePath("/assets");
    return null;
  }, "Statut mis à jour.");
}

export async function disposeAsset(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:dispose");
    const data = disposalSchema.parse(input);
    const asset = await getCompanyAssetOrThrow(company.id, data.assetId);
    if (asset.status === "DISPOSED") throw new AppError("Ce bien est déjà sorti de l'actif.");
    const startDate = asset.commissioningDate ?? asset.acquisitionDate;
    if (data.disposalDate < asset.acquisitionDate) throw new AppError("La date de sortie précède la date d'acquisition.");
    const dep = computeDepreciation(
      { ...toDepreciationInput(asset, company.fiscalYearStartMonth), startDate, disposalDate: data.disposalDate },
      data.disposalDate,
    );
    const proceeds = data.disposalValue ?? 0;
    const result = round2(proceeds - dep.netBookValue);
    const ip = await clientIp();
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          status: "DISPOSED",
          disposalDate: data.disposalDate,
          disposalType: data.disposalType,
          disposalValue: data.disposalValue,
          disposalReason: data.reason,
          custodianId: null,
        },
      });
      await tx.custodianAssignment.updateMany({
        where: { assetId: asset.id, returnedAt: null },
        data: { returnedAt: new Date(), notes: "Clôturée par la sortie d'actif" },
      });
      await recordEvents(tx, [
        {
          companyId: company.id,
          assetId: asset.id,
          type: "DISPOSED",
          summary: `${DISPOSAL_TYPE_LABELS[data.disposalType]} le ${formatDate(data.disposalDate)} — VNC ${dep.netBookValue.toFixed(2)}, prix ${proceeds.toFixed(2)}`,
          fromStatus: asset.status,
          toStatus: "DISPOSED",
          fromCustodianId: asset.custodianId,
          data: {
            disposalType: data.disposalType,
            reason: data.reason,
            accumulatedDepreciation: dep.accumulated,
            netBookValue: dep.netBookValue,
            proceeds,
            gainOrLoss: result,
          },
          userId: user.id,
          ipAddress: ip,
        },
      ]);
    });
    revalidatePath(`/assets/${asset.id}`);
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return { netBookValue: dep.netBookValue, gainOrLoss: result };
  }, "Sortie d'actif enregistrée.");
}

// ---------------------------------------------------------------------------
// Custodian assignment with e-signature (décharge)
// ---------------------------------------------------------------------------

export async function assignCustodian(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:assign");
    const data = assignmentSchema.parse(input);
    const asset = await getCompanyAssetOrThrow(company.id, data.assetId);
    if (asset.status === "DISPOSED") throw new AppError("Ce bien est sorti de l'actif.");
    await assertCompanyRefs(company.id, { employeeId: data.employeeId });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: data.employeeId } });

    const png = Buffer.from(data.signatureDataUrl.split(",")[1] ?? "", "base64");
    if (png.length < 200 || png[0] !== 0x89 || png.subarray(1, 4).toString("latin1") !== "PNG") {
      throw new AppError("Signature invalide ou vide.");
    }
    const signatureKey = buildStorageKey(company.id, "signatures", "png");
    await putObject(signatureKey, png);
    const ip = await clientIp();
    const now = new Date();

    const assignment = await prisma.$transaction(async (tx) => {
      const open = await tx.custodianAssignment.findMany({ where: { assetId: asset.id, returnedAt: null } });
      const events: AssetEventInput[] = [];
      if (open.length) {
        await tx.custodianAssignment.updateMany({
          where: { id: { in: open.map((o) => o.id) } },
          data: { returnedAt: now, conditionAtReturn: data.condition },
        });
        events.push({
          companyId: company.id,
          assetId: asset.id,
          type: "CUSTODIAN_RETURNED",
          summary: "Restitution automatique (réaffectation)",
          fromCustodianId: asset.custodianId,
          userId: user.id,
          ipAddress: ip,
        });
      }
      const created = await tx.custodianAssignment.create({
        data: {
          companyId: company.id,
          assetId: asset.id,
          employeeId: employee.id,
          assignedAt: now,
          conditionAtHandover: data.condition,
          signatureKey,
          signerName: data.signerName,
          signedAt: now,
          signerIp: ip,
          notes: data.notes,
          assignedById: user.id,
        },
      });
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          custodianId: employee.id,
          condition: data.condition,
          departmentId: employee.departmentId ?? asset.departmentId,
          status: asset.status === "IN_STOCK" ? "IN_SERVICE" : asset.status,
          commissioningDate: asset.commissioningDate ?? (asset.status === "IN_STOCK" ? now : undefined),
        },
      });
      events.push({
        companyId: company.id,
        assetId: asset.id,
        type: "CUSTODIAN_ASSIGNED",
        summary: `Affecté à ${employee.firstName} ${employee.lastName} (${employee.matricule}) — décharge signée par ${data.signerName}`,
        fromCustodianId: asset.custodianId,
        toCustodianId: employee.id,
        fromStatus: asset.status,
        toStatus: asset.status === "IN_STOCK" ? "IN_SERVICE" : asset.status,
        data: { assignmentId: created.id, signatureKey, condition: data.condition },
        userId: user.id,
        ipAddress: ip,
      });
      await recordEvents(tx, events);
      return created;
    });
    revalidatePath(`/assets/${asset.id}`);
    return { assignmentId: assignment.id };
  }, "Affectation signée et enregistrée.");
}

export async function returnAsset(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("asset:assign");
    const data = returnSchema.parse(input);
    const asset = await getCompanyAssetOrThrow(company.id, data.assetId);
    if (!asset.custodianId) throw new AppError("Ce bien n'est affecté à aucun collaborateur.");
    const ip = await clientIp();
    await prisma.$transaction(async (tx) => {
      await tx.custodianAssignment.updateMany({
        where: { assetId: asset.id, returnedAt: null },
        data: { returnedAt: new Date(), conditionAtReturn: data.condition, notes: data.notes ?? undefined },
      });
      await tx.asset.update({
        where: { id: asset.id },
        data: { custodianId: null, condition: data.condition, status: asset.status === "IN_SERVICE" ? "IN_STOCK" : asset.status },
      });
      await recordEvents(tx, [
        {
          companyId: company.id,
          assetId: asset.id,
          type: "CUSTODIAN_RETURNED",
          summary: `Restitution — état : ${ASSET_CONDITION_LABELS[data.condition]}${data.notes ? ` — ${data.notes}` : ""}`,
          fromCustodianId: asset.custodianId,
          fromStatus: asset.status,
          toStatus: asset.status === "IN_SERVICE" ? "IN_STOCK" : asset.status,
          userId: user.id,
          ipAddress: ip,
        },
      ]);
    });
    revalidatePath(`/assets/${asset.id}`);
    return null;
  }, "Restitution enregistrée.");
}

// ---------------------------------------------------------------------------
// Import of the accounting register (Excel)
// ---------------------------------------------------------------------------

export interface ImportReport {
  created: number;
  errors: { rowNumber: number; message: string }[];
}

export async function importAssets(rows: ImportRowInput[]) {
  return runAction(async (): Promise<ImportReport> => {
    const { user, company } = await requireActionContext("asset:import");
    if (!Array.isArray(rows) || rows.length === 0) throw new AppError("Le fichier ne contient aucune ligne.");
    if (rows.length > 10_000) throw new AppError("10 000 lignes maximum par import.");

    const [categories, locations, costCenters, employees, suppliers, existingCodes] = await Promise.all([
      prisma.assetCategory.findMany({ where: { companyId: company.id } }),
      prisma.location.findMany({ where: { companyId: company.id }, select: { id: true, code: true } }),
      prisma.costCenter.findMany({ where: { companyId: company.id }, select: { id: true, code: true } }),
      prisma.employee.findMany({ where: { companyId: company.id }, select: { id: true, matricule: true, departmentId: true } }),
      prisma.supplier.findMany({ where: { companyId: company.id }, select: { id: true, name: true } }),
      prisma.asset.findMany({ where: { companyId: company.id }, select: { code: true } }),
    ]);
    const catByCode = new Map(categories.map((c) => [c.code.toUpperCase(), c]));
    const locByCode = new Map(locations.map((l) => [l.code.toUpperCase(), l.id]));
    const ccByCode = new Map(costCenters.map((c) => [c.code.toUpperCase(), c.id]));
    const empByMat = new Map(employees.map((e) => [e.matricule.toUpperCase(), e]));
    const supByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
    const usedCodes = new Set(existingCodes.map((a) => a.code.toUpperCase()));

    const errors: ImportReport["errors"] = [];
    const valid: { row: ReturnType<typeof importRowSchema.parse>; categoryId: string; method: Asset["depreciationMethod"]; life: number; coef: number | null; locationId: string | null; costCenterId: string | null; custodian: { id: string; departmentId: string | null } | null }[] = [];

    rows.forEach((input, index) => {
      const rowNumber = typeof input?.rowNumber === "number" ? input.rowNumber : index + 2;
      const parsed = importRowSchema.safeParse({ ...input, rowNumber });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        errors.push({ rowNumber, message: `${issue?.path.join(".") || "ligne"} : ${issue?.message ?? "invalide"}` });
        return;
      }
      const row = parsed.data;
      const category = catByCode.get(row.categoryCode.toUpperCase());
      if (!category) return void errors.push({ rowNumber, message: `Catégorie « ${row.categoryCode} » inconnue` });
      const locationId = row.locationCode ? locByCode.get(row.locationCode.toUpperCase()) ?? null : null;
      if (row.locationCode && !locationId) return void errors.push({ rowNumber, message: `Localisation « ${row.locationCode} » inconnue` });
      const costCenterId = row.costCenterCode ? ccByCode.get(row.costCenterCode.toUpperCase()) ?? null : null;
      if (row.costCenterCode && !costCenterId) return void errors.push({ rowNumber, message: `Centre de coût « ${row.costCenterCode} » inconnu` });
      const custodian = row.custodianMatricule ? empByMat.get(row.custodianMatricule.toUpperCase()) ?? null : null;
      if (row.custodianMatricule && !custodian) return void errors.push({ rowNumber, message: `Matricule « ${row.custodianMatricule} » inconnu` });
      if (row.code) {
        const upper = row.code.toUpperCase();
        if (usedCodes.has(upper)) return void errors.push({ rowNumber, message: `Code « ${row.code} » déjà utilisé` });
        usedCodes.add(upper);
      }
      if (row.commissioningDate && row.commissioningDate < row.acquisitionDate) {
        return void errors.push({ rowNumber, message: "Mise en service antérieure à l'acquisition" });
      }
      valid.push({
        row,
        categoryId: category.id,
        method: row.depreciationMethod ?? category.defaultMethod,
        life: row.usefulLifeYears ?? category.defaultUsefulLifeYears,
        coef: category.decliningCoefficient ? Number(category.decliningCoefficient) : null,
        locationId,
        costCenterId,
        custodian: custodian ? { id: custodian.id, departmentId: custodian.departmentId } : null,
      });
    });

    if (errors.length) return { created: 0, errors: errors.slice(0, 500) };

    const ip = await clientIp();
    const created = await prisma.$transaction(
      async (tx) => {
        // Suppliers referenced by name are created on the fly.
        for (const v of valid) {
          const name = v.row.supplierName?.trim();
          if (name && !supByName.has(name.toLowerCase())) {
            const s = await tx.supplier.create({ data: { companyId: company.id, name } });
            supByName.set(name.toLowerCase(), s.id);
          }
        }
        const generated = await nextAssetCodes(tx, company.id, valid.filter((v) => !v.row.code).length);
        let g = 0;
        const data: Prisma.AssetCreateManyInput[] = valid.map((v) => ({
          companyId: company.id,
          code: v.row.code ? v.row.code.toUpperCase() : generated[g++],
          designation: v.row.designation,
          brand: v.row.brand,
          model: v.row.model,
          serialNumber: v.row.serialNumber,
          quantity: v.row.quantity,
          categoryId: v.categoryId,
          supplierId: v.row.supplierName ? supByName.get(v.row.supplierName.trim().toLowerCase()) ?? null : null,
          acquisitionDate: v.row.acquisitionDate,
          commissioningDate: v.row.commissioningDate ?? v.row.acquisitionDate,
          acquisitionValue: v.row.acquisitionValue,
          depreciationMethod: v.method,
          usefulLifeYears: v.method === "NONE" ? 0 : v.life,
          decliningCoefficient: v.method === "DECLINING" ? v.coef : null,
          status: v.row.status && v.row.status !== "DISPOSED" ? v.row.status : "IN_SERVICE",
          origin: "IMPORT",
          locationId: v.locationId,
          costCenterId: v.costCenterId,
          custodianId: v.custodian?.id ?? null,
          departmentId: v.custodian?.departmentId ?? null,
          notes: v.row.notes,
          createdById: user.id,
        }));
        const assets: { id: string; code: string; custodianId: string | null; locationId: string | null; status: Asset["status"] }[] = [];
        for (let i = 0; i < data.length; i += 1000) {
          const batch = await tx.asset.createManyAndReturn({
            data: data.slice(i, i + 1000),
            select: { id: true, code: true, custodianId: true, locationId: true, status: true },
          });
          assets.push(...batch);
        }
        const withCustodian = assets.filter((a) => a.custodianId);
        if (withCustodian.length) {
          await tx.custodianAssignment.createMany({
            data: withCustodian.map((a) => ({
              companyId: company.id,
              assetId: a.id,
              employeeId: a.custodianId!,
              notes: "Reprise de l'existant (import du fichier des immobilisations)",
              assignedById: user.id,
            })),
          });
        }
        await recordEvents(
          tx,
          assets.map((a) => ({
            companyId: company.id,
            assetId: a.id,
            type: "CREATED" as const,
            summary: `Import du fichier des immobilisations (${a.code})`,
            toLocationId: a.locationId,
            toCustodianId: a.custodianId,
            toStatus: a.status,
            userId: user.id,
            ipAddress: ip,
          })),
        );
        return assets.length;
      },
      { timeout: 120_000 },
    );
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return { created, errors: [] };
  });
}

// ---------------------------------------------------------------------------
// Register export (Fichier des immobilisations / balance)
// ---------------------------------------------------------------------------

export interface RegisterExportRow {
  code: string;
  designation: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  categoryCode: string;
  categoryName: string;
  assetAccount: string;
  depreciationAccount: string | null;
  supplier: string | null;
  invoiceNumber: string | null;
  acquisitionDate: string;
  commissioningDate: string | null;
  grossValue: number;
  method: string;
  usefulLifeYears: number;
  rate: number;
  currentYearAnnuity: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  location: string | null;
  costCenter: string | null;
  custodian: string | null;
  status: string;
  tagStatus: string;
  disposalDate: string | null;
}

export async function getRegisterExport(options: { asOf?: string; includeDisposed?: boolean }) {
  return runAction(async () => {
    const { company } = await requireActionContext("asset:read");
    const asOf = options.asOf && /^\d{4}-\d{2}-\d{2}$/.test(options.asOf) ? new Date(`${options.asOf}T00:00:00Z`) : new Date();
    const assets = await prisma.asset.findMany({
      where: {
        companyId: company.id,
        acquisitionDate: { lte: asOf },
        ...(options.includeDisposed ? {} : { OR: [{ disposalDate: null }, { disposalDate: { gt: asOf } }] }),
      },
      include: {
        category: true,
        supplier: { select: { name: true } },
        invoice: { select: { number: true } },
        location: { select: { path: true } },
        costCenter: { select: { code: true, name: true } },
        custodian: { select: { firstName: true, lastName: true, matricule: true } },
      },
      orderBy: [{ category: { assetAccount: "asc" } }, { code: "asc" }],
    });
    const rows: RegisterExportRow[] = assets.map((a) => {
      const dep = assetDepreciation(a, asOf, company.fiscalYearStartMonth);
      return {
        code: a.code,
        designation: a.designation,
        brand: a.brand,
        model: a.model,
        serialNumber: a.serialNumber,
        categoryCode: a.category.code,
        categoryName: a.category.name,
        assetAccount: a.category.assetAccount,
        depreciationAccount: a.category.depreciationAccount,
        supplier: a.supplier?.name ?? null,
        invoiceNumber: a.invoice?.number ?? null,
        acquisitionDate: a.acquisitionDate.toISOString().slice(0, 10),
        commissioningDate: a.commissioningDate?.toISOString().slice(0, 10) ?? null,
        grossValue: Number(a.acquisitionValue),
        method: a.depreciationMethod,
        usefulLifeYears: a.usefulLifeYears,
        rate: dep.annualRate,
        currentYearAnnuity: dep.currentYearAnnuity,
        accumulatedDepreciation: dep.accumulated,
        netBookValue: dep.netBookValue,
        location: a.location?.path ?? null,
        costCenter: a.costCenter ? `${a.costCenter.code} — ${a.costCenter.name}` : null,
        custodian: a.custodian ? `${a.custodian.firstName} ${a.custodian.lastName} (${a.custodian.matricule})` : null,
        status: a.status,
        tagStatus: a.tagStatus,
        disposalDate: a.disposalDate?.toISOString().slice(0, 10) ?? null,
      };
    });
    return {
      asOf: asOf.toISOString().slice(0, 10),
      company: { name: company.name, legalName: company.legalName, ice: company.ice, currency: company.currency },
      rows,
    };
  });
}
