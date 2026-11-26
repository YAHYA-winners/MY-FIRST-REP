import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { PageHeader } from "@/components/page-header";
import { CampaignForm } from "@/components/campaigns/campaign-form";

export const metadata: Metadata = { title: "Nouvelle campagne" };

export default async function NewCampaignPage() {
  const { company } = await requirePageContext("campaign:manage");
  const [locations, categories, members] = await Promise.all([
    prisma.location.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { path: "asc" },
      select: { id: true, parentId: true, name: true, path: true, type: true, depth: true },
    }),
    prisma.assetCategory.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { assetAccount: "asc" },
      select: { id: true, name: true, assetAccount: true, trackPhysically: true },
    }),
    prisma.userCompany.findMany({
      where: { companyId: company.id, user: { active: true } },
      select: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  return (
    <div>
      <PageHeader
        title="Nouvelle campagne d'inventaire"
        description="Le fichier comptable théorique (biens attendus, localisation, VNC) sera figé au lancement de la campagne."
      />
      <CampaignForm locations={locations} categories={categories} users={members.map((m) => m.user)} />
    </div>
  );
}
