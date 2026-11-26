import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActionContext } from "@/lib/server/auth";
import { handleApiError, jsonError } from "@/lib/server/api";
import { resolveAssetByCode } from "@/lib/server/field-service";

export const dynamic = "force-dynamic";

/** Resolves a code that is not part of the campaign snapshot (out-of-scope, disposed or unknown). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { company } = await requireActionContext("campaign:scan");
    const { id } = await params;
    const code = new URL(req.url).searchParams.get("code")?.trim();
    if (!code) return jsonError("Paramètre « code » manquant.", 400);
    const campaign = await prisma.inventoryCampaign.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!campaign) return jsonError("Campagne introuvable.", 404);
    const asset = await resolveAssetByCode(company.id, code.slice(0, 500));
    if (!asset) return NextResponse.json({ found: false });
    const inSnapshot = await prisma.campaignSnapshotItem.count({ where: { campaignId: id, assetId: asset.id } });
    return NextResponse.json({
      found: true,
      asset: {
        id: asset.id,
        code: asset.code,
        designation: asset.designation,
        serialNumber: asset.serialNumber,
        status: asset.status,
        locationId: asset.locationId,
        locationPath: asset.location?.path ?? null,
        inSnapshot: inSnapshot > 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
