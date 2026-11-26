import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { PageHeader } from "@/components/page-header";
import { AssetImporter } from "@/components/assets/asset-importer";

export const metadata: Metadata = { title: "Import du fichier des immobilisations" };

export default async function AssetImportPage() {
  const { company } = await requirePageContext("asset:import");
  const [categories, locations, costCenters, employees] = await Promise.all([
    prisma.assetCategory.findMany({ where: { companyId: company.id, active: true }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
    prisma.location.findMany({ where: { companyId: company.id, active: true }, orderBy: { path: "asc" }, select: { code: true, path: true } }),
    prisma.costCenter.findMany({ where: { companyId: company.id, active: true }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
    prisma.employee.findMany({ where: { companyId: company.id, active: true }, orderBy: { lastName: "asc" }, select: { matricule: true, firstName: true, lastName: true } }),
  ]);
  return (
    <div>
      <PageHeader
        title="Import du fichier comptable des immobilisations"
        description="Reprise de l'existant depuis votre ERP ou un tableur : chaque ligne est contrôlée (catégorie, localisation, centre de coût, détenteur, doublons) avant création."
      />
      <AssetImporter
        referentials={{
          categories,
          locations,
          costCenters,
          employees: employees.map((e) => ({ matricule: e.matricule, name: `${e.firstName} ${e.lastName}` })),
        }}
      />
    </div>
  );
}
