import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { LocationTree } from "@/components/locations/location-tree";

export const metadata: Metadata = { title: "Localisations" };

export default async function LocationsPage() {
  const { user, company } = await requirePageContext("asset:read");
  const [locations, departments] = await Promise.all([
    prisma.location.findMany({
      where: { companyId: company.id },
      orderBy: [{ depth: "asc" }, { name: "asc" }],
      select: {
        id: true,
        parentId: true,
        type: true,
        code: true,
        name: true,
        path: true,
        pathIds: true,
        departmentId: true,
        address: true,
        active: true,
        _count: { select: { assets: true } },
      },
    }),
    prisma.department.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader
        title="Arborescence des localisations"
        description="Sites / agences › bâtiments › étages › directions › bureaux et locaux. Imprimez des QR de local pour que les inventoristes positionnent leur comptage d'un simple scan."
      />
      <LocationTree
        locations={locations.map((l) => ({ ...l, assetCount: l._count.assets }))}
        departments={departments}
        canEdit={can(user.role, "location:write")}
      />
    </div>
  );
}
