import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { expandLocationSubtrees } from "@/lib/server/locations";
import { FieldScanner } from "@/components/scanner/field-scanner";

export const metadata: Metadata = { title: "Mode terrain" };

/** Full-screen, high-contrast field mode (the app shell hides its sidebar on this route). */
export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function FieldScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requirePageContext("campaign:scan");
  const { id } = await params;
  const campaign = await prisma.inventoryCampaign.findFirst({
    where: { id, companyId: company.id },
    select: { id: true, code: true, name: true, status: true, scopeLocations: { select: { locationId: true } } },
  });
  if (!campaign) notFound();
  const [locations, categories] = await Promise.all([
    prisma.location.findMany({
      where: { companyId: company.id, active: true },
      select: { id: true, code: true, name: true, path: true, type: true },
      orderBy: { path: "asc" },
    }),
    prisma.assetCategory.findMany({ where: { companyId: company.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const scopeIds = campaign.scopeLocations.length
    ? new Set(await expandLocationSubtrees(company.id, campaign.scopeLocations.map((s) => s.locationId)))
    : null;
  return (
    <FieldScanner
      campaign={{ id: campaign.id, code: campaign.code, name: campaign.name, status: campaign.status }}
      locations={locations.map((l) => ({ ...l, inScope: scopeIds ? scopeIds.has(l.id) : true }))}
      categories={categories}
      currency={company.currency}
    />
  );
}
