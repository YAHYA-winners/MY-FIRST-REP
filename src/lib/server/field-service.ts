import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { parseScannedCode } from "@/lib/codes";
import { ASSET_CONDITION_LABELS } from "@/lib/constants";
import type { ScanInput, SurplusInput } from "@/lib/validators";
import { scanSchema, surplusSchema } from "@/lib/validators";
import type { AppContext } from "@/lib/server/auth";
import { recordEvents, type AssetEventInput } from "@/lib/server/audit";
import { nextTempTag } from "@/lib/server/sequences";

export type ScanOutcome = "MATCH" | "MISPLACED" | "OUT_OF_SCOPE" | "DISPOSED";

export interface ScanResult {
  scanId: string;
  outcome: ScanOutcome;
  duplicate: boolean;
  asset: { id: string; code: string; designation: string; status: string };
  expectedLocationPath: string | null;
}

/** Resolves a scanned payload (QR deep-link, asset code, legacy barcode or serial number). */
export async function resolveAssetByCode(companyId: string, rawCode: string) {
  const parsed = parseScannedCode(rawCode);
  if (parsed.kind === "location") return null;
  const code = parsed.kind === "asset" ? parsed.code : parsed.value;
  const byCode = await prisma.asset.findFirst({
    where: { companyId, code: { equals: code, mode: "insensitive" } },
    include: { location: { select: { path: true } } },
  });
  if (byCode) return byCode;
  if (parsed.kind === "raw" && code.length >= 3) {
    const bySerial = await prisma.asset.findMany({
      where: { companyId, serialNumber: { equals: code, mode: "insensitive" } },
      include: { location: { select: { path: true } } },
      take: 2,
    });
    if (bySerial.length === 1) return bySerial[0];
  }
  return null;
}

async function assertCampaignOpen(companyId: string, campaignId: string) {
  const campaign = await prisma.inventoryCampaign.findFirst({ where: { id: campaignId, companyId } });
  if (!campaign) throw new AppError("Campagne introuvable.", 404);
  if (campaign.status !== "IN_PROGRESS") throw new AppError("Le comptage de cette campagne est fermé.", 409);
  return campaign;
}

async function assertLocation(companyId: string, locationId: string) {
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId }, select: { id: true, path: true } });
  if (!location) throw new AppError("Localisation invalide.", 400);
  return location;
}

function assertOwnKey(companyId: string, key: string | null) {
  if (key && !key.startsWith(`${companyId}/`)) throw new AppError("Photo invalide.", 400);
}

async function describeExistingScan(scanId: string): Promise<ScanResult> {
  const scan = await prisma.campaignScan.findUniqueOrThrow({
    where: { id: scanId },
    include: { asset: true, snapshotItem: true },
  });
  const outcome: ScanOutcome = scan.snapshotItem
    ? scan.isLocationMismatch
      ? "MISPLACED"
      : "MATCH"
    : scan.asset.status === "DISPOSED"
      ? "DISPOSED"
      : "OUT_OF_SCOPE";
  return {
    scanId: scan.id,
    outcome,
    duplicate: true,
    asset: { id: scan.asset.id, code: scan.asset.code, designation: scan.asset.designation, status: scan.asset.status },
    expectedLocationPath: scan.snapshotItem?.expectedLocationPath ?? null,
  };
}

export async function recordScan(ctx: AppContext, campaignId: string, input: ScanInput, ip: string | null): Promise<ScanResult> {
  const data = scanSchema.parse(input);
  const companyId = ctx.company.id;
  const campaign = await assertCampaignOpen(companyId, campaignId);

  const existing = await prisma.campaignScan.findUnique({ where: { clientId: data.clientId }, select: { id: true, campaignId: true } });
  if (existing) {
    if (existing.campaignId !== campaignId) throw new AppError("Identifiant de scan déjà utilisé.", 409);
    return describeExistingScan(existing.id);
  }

  const location = await assertLocation(companyId, data.locationId);
  assertOwnKey(companyId, data.photoKey);
  const asset = await resolveAssetByCode(companyId, data.code);
  if (!asset) throw new AppError("UNKNOWN_CODE: code inconnu du registre — enregistrez le bien comme excédent.", 404);

  const snapshotItem = await prisma.campaignSnapshotItem.findUnique({
    where: { campaignId_assetId: { campaignId, assetId: asset.id } },
  });
  const isMismatch = snapshotItem ? snapshotItem.expectedLocationId !== location.id : asset.locationId !== location.id;
  const outcome: ScanOutcome = snapshotItem
    ? isMismatch
      ? "MISPLACED"
      : "MATCH"
    : asset.status === "DISPOSED"
      ? "DISPOSED"
      : "OUT_OF_SCOPE";
  const scannedAt = data.scannedAt.getTime() > Date.now() + 5 * 60_000 ? new Date() : data.scannedAt;

  try {
    const scan = await prisma.$transaction(async (tx) => {
      const created = await tx.campaignScan.create({
        data: {
          campaignId,
          clientId: data.clientId,
          assetId: asset.id,
          snapshotItemId: snapshotItem?.id ?? null,
          scannedCode: data.code.slice(0, 500),
          locationId: location.id,
          condition: data.condition,
          isLocationMismatch: isMismatch,
          transferProposed: isMismatch && data.transferProposed,
          manualEntry: data.manualEntry,
          photoKey: data.photoKey,
          notes: data.notes,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          gpsAccuracy: data.gpsAccuracy ?? null,
          deviceInfo: data.deviceInfo,
          scannedById: ctx.user.id,
          scannedAt,
        },
      });
      const tagNowAffixed = !data.manualEntry && asset.tagStatus !== "AFFIXED";
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          lastSeenAt: scannedAt,
          condition: data.condition,
          ...(tagNowAffixed ? { tagStatus: "AFFIXED", tagAffixedAt: scannedAt } : {}),
        },
      });
      const gps = { latitude: data.latitude ?? null, longitude: data.longitude ?? null, gpsAccuracy: data.gpsAccuracy ?? null };
      const events: AssetEventInput[] = [
        {
          companyId,
          assetId: asset.id,
          type: "SCANNED",
          summary: `Scan ${campaign.code} à ${location.path}${isMismatch ? " — écart de localisation" : ""}${data.manualEntry ? " (saisie manuelle)" : ""}`,
          campaignId,
          userId: ctx.user.id,
          ipAddress: ip,
          data: {
            scanId: created.id,
            locationId: location.id,
            outcome,
            condition: data.condition,
            transferProposed: created.transferProposed,
          } satisfies Prisma.InputJsonValue,
          ...gps,
        },
      ];
      if (asset.condition !== data.condition) {
        events.push({
          companyId,
          assetId: asset.id,
          type: "CONDITION_CHANGE",
          summary: `État constaté à l'inventaire : ${ASSET_CONDITION_LABELS[asset.condition]} → ${ASSET_CONDITION_LABELS[data.condition]}`,
          campaignId,
          userId: ctx.user.id,
          ipAddress: ip,
          data: { from: asset.condition, to: data.condition, photoKey: data.photoKey },
          ...gps,
        });
      }
      if (tagNowAffixed) {
        events.push({
          companyId,
          assetId: asset.id,
          type: "TAG_AFFIXED",
          summary: "Étiquette QR confirmée posée (premier scan)",
          campaignId,
          userId: ctx.user.id,
          ipAddress: ip,
          ...gps,
        });
      }
      await recordEvents(tx, events);
      return created;
    });
    return {
      scanId: scan.id,
      outcome,
      duplicate: false,
      asset: { id: asset.id, code: asset.code, designation: asset.designation, status: asset.status },
      expectedLocationPath: snapshotItem?.expectedLocationPath ?? asset.location?.path ?? null,
    };
  } catch (error) {
    // Two concurrent retries of the same offline-queued scan: return the stored one.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await prisma.campaignScan.findUnique({ where: { clientId: data.clientId }, select: { id: true } });
      if (again) return describeExistingScan(again.id);
    }
    throw error;
  }
}

export type SurplusResult =
  | { kind: "surplus"; surplusId: string; tempTag: string; duplicate: boolean }
  | { kind: "scan"; scan: ScanResult };

export async function recordSurplus(ctx: AppContext, campaignId: string, input: SurplusInput, ip: string | null): Promise<SurplusResult> {
  const data = surplusSchema.parse(input);
  const companyId = ctx.company.id;
  await assertCampaignOpen(companyId, campaignId);

  const existing = await prisma.campaignSurplus.findUnique({ where: { clientId: data.clientId } });
  if (existing) {
    if (existing.campaignId !== campaignId) throw new AppError("Identifiant déjà utilisé.", 409);
    return { kind: "surplus", surplusId: existing.id, tempTag: existing.tempTag, duplicate: true };
  }

  // A code read offline may in fact belong to a registered asset: record a regular scan instead.
  if (data.scannedCode) {
    const asset = await resolveAssetByCode(companyId, data.scannedCode);
    if (asset && asset.status !== "DISPOSED") {
      const scan = await recordScan(
        ctx,
        campaignId,
        {
          clientId: data.clientId,
          code: data.scannedCode,
          locationId: data.locationId,
          condition: data.condition,
          transferProposed: true,
          manualEntry: false,
          photoKey: data.photoKey,
          notes: data.notes,
          scannedAt: data.foundAt,
          latitude: data.latitude,
          longitude: data.longitude,
          gpsAccuracy: data.gpsAccuracy,
        },
        ip,
      );
      return { kind: "scan", scan };
    }
  }

  await assertLocation(companyId, data.locationId);
  assertOwnKey(companyId, data.photoKey);
  if (data.categoryId) {
    const ok = await prisma.assetCategory.count({ where: { id: data.categoryId, companyId } });
    if (!ok) throw new AppError("Catégorie invalide.", 400);
  }
  const surplus = await prisma.$transaction(async (tx) => {
    const tempTag = await nextTempTag(tx, companyId);
    return tx.campaignSurplus.create({
      data: {
        campaignId,
        clientId: data.clientId,
        tempTag,
        scannedCode: data.scannedCode,
        designation: data.designation,
        description: data.description,
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        categoryId: data.categoryId,
        estimatedValue: data.estimatedValue,
        condition: data.condition,
        locationId: data.locationId,
        photoKey: data.photoKey,
        notes: data.notes,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        gpsAccuracy: data.gpsAccuracy ?? null,
        foundById: ctx.user.id,
        foundAt: data.foundAt,
      },
    });
  });
  return { kind: "surplus", surplusId: surplus.id, tempTag: surplus.tempTag, duplicate: false };
}
