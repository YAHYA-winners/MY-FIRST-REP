import type { Metadata } from "next";
import { requirePageContext } from "@/lib/server/auth";
import { getAssetFormOptions } from "@/lib/server/queries/assets";
import { PageHeader } from "@/components/page-header";
import { AssetForm } from "@/components/assets/asset-form";
import { emptyAssetValues } from "@/lib/asset-form-values";

export const metadata: Metadata = { title: "Nouvelle immobilisation" };

export default async function NewAssetPage() {
  const { company } = await requirePageContext("asset:write");
  const options = await getAssetFormOptions(company.id);
  return (
    <div>
      <PageHeader
        title="Nouvelle immobilisation"
        description="Saisie manuelle d'une fiche. Pour une acquisition sur facture, préférez l'import IA qui rattache automatiquement la pièce justificative."
      />
      <AssetForm options={options} initial={emptyAssetValues()} currency={company.currency} />
    </div>
  );
}
