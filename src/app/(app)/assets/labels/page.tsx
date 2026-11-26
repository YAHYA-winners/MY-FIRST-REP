import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { PageHeader } from "@/components/page-header";
import { LabelStudio } from "@/components/labels/label-studio";

export const metadata: Metadata = { title: "Étiquetage QR" };

export default async function LabelsPage() {
  const { company } = await requirePageContext("label:print");
  const [assets, categories, locations] = await Promise.all([
    prisma.asset.findMany({
      where: { companyId: company.id, status: { not: "DISPOSED" } },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        designation: true,
        serialNumber: true,
        tagStatus: true,
        tagPrintedAt: true,
        categoryId: true,
        location: { select: { path: true, name: true } },
      },
    }),
    prisma.assetCategory.findMany({ where: { companyId: company.id }, orderBy: { assetAccount: "asc" }, select: { id: true, name: true } }),
    prisma.location.findMany({
      where: { companyId: company.id, active: true },
      orderBy: { path: "asc" },
      select: { id: true, code: true, name: true, path: true, type: true },
    }),
  ]);
  return (
    <div>
      <PageHeader
        title="Label Studio — étiquettes QR"
        description="Sélectionnez les biens à étiqueter, choisissez le support (rouleau thermique ou planche A4) et imprimez. Le statut passe automatiquement à « Étiquette imprimée », puis « posée » au premier scan terrain."
      />
      <LabelStudio
        companyName={company.name}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
        assets={assets.map((a) => ({
          id: a.id,
          code: a.code,
          designation: a.designation,
          serialNumber: a.serialNumber,
          tagStatus: a.tagStatus,
          tagPrintedAt: a.tagPrintedAt?.toISOString() ?? null,
          categoryId: a.categoryId,
          locationPath: a.location?.path ?? null,
          locationName: a.location?.name ?? null,
        }))}
        categories={categories}
        locations={locations}
      />
    </div>
  );
}
