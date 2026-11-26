import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { getAssetFormOptions } from "@/lib/server/queries/assets";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "@/components/assets/asset-form";
import type { AssetFormValues } from "@/lib/asset-form-values";
import { toDateInput } from "@/lib/format";

export const metadata: Metadata = { title: "Modifier l'immobilisation" };

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requirePageContext("asset:write");
  const { id } = await params;
  const asset = await prisma.asset.findFirst({ where: { id, companyId: company.id } });
  if (!asset) notFound();
  if (asset.status === "DISPOSED") redirect(`/assets/${asset.id}`);
  const options = await getAssetFormOptions(company.id);
  const initial: AssetFormValues = {
    designation: asset.designation,
    description: asset.description ?? "",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serialNumber ?? "",
    quantity: String(asset.quantity),
    categoryId: asset.categoryId,
    supplierId: asset.supplierId ?? "",
    acquisitionDate: toDateInput(asset.acquisitionDate),
    commissioningDate: toDateInput(asset.commissioningDate),
    acquisitionValue: String(Number(asset.acquisitionValue)),
    vatRate: asset.vatRate ? String(Number(asset.vatRate)) : "20",
    depreciationMethod: asset.depreciationMethod,
    usefulLifeYears: String(asset.usefulLifeYears),
    decliningCoefficient: asset.decliningCoefficient ? String(Number(asset.decliningCoefficient)) : "",
    residualValue: String(Number(asset.residualValue)),
    status: asset.status,
    condition: asset.condition,
    locationId: asset.locationId ?? "",
    departmentId: asset.departmentId ?? "",
    costCenterId: asset.costCenterId ?? "",
    warrantyEndDate: toDateInput(asset.warrantyEndDate),
    notes: asset.notes ?? "",
  };
  return (
    <div>
      <PageHeader eyebrow={asset.code} title="Modifier la fiche" description="Chaque modification est tracée dans l'historique immuable du bien (valeurs avant / après)." />
      <AssetForm options={options} initial={initial} assetId={asset.id} currency={company.currency} />
    </div>
  );
}
