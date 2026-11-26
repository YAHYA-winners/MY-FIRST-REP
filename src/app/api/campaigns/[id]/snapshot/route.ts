import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActionContext } from "@/lib/server/auth";
import { handleApiError, jsonError } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/**
 * Compact theoretical register for the field scanner (instant local matching,
 * works through short network outages). Also returns the ids already counted by
 * the whole team so progress stays in sync across devices.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { company } = await requireActionContext("campaign:scan");
    const { id } = await params;
    const campaign = await prisma.inventoryCampaign.findFirst({
      where: { id, companyId: company.id },
      select: { id: true, status: true },
    });
    if (!campaign) return jsonError("Campagne introuvable.", 404);
    const [items, scanned, surplusCount] = await Promise.all([
      prisma.campaignSnapshotItem.findMany({
        where: { campaignId: id },
        select: { assetId: true, assetCode: true, designation: true, serialNumber: true, expectedLocationId: true, categoryName: true },
        orderBy: { assetCode: "asc" },
      }),
      prisma.campaignScan.findMany({ where: { campaignId: id }, select: { assetId: true }, distinct: ["assetId"] }),
      prisma.campaignSurplus.count({ where: { campaignId: id } }),
    ]);
    return NextResponse.json(
      {
        status: campaign.status,
        items: items.map((i) => ({
          a: i.assetId,
          c: i.assetCode,
          d: i.designation,
          s: i.serialNumber,
          l: i.expectedLocationId,
          k: i.categoryName,
        })),
        scanned: scanned.map((s) => s.assetId),
        surplusCount,
        serverTime: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
