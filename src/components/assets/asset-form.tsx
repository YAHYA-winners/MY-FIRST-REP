"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { createAsset, updateAsset } from "@/actions/assets";
import type { AssetFormOptions } from "@/lib/server/queries/assets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS, DEPRECIATION_METHOD_LABELS, VAT_RATES } from "@/lib/constants";
import { ASSET_CONDITIONS, ASSET_STATUSES, DEPRECIATION_METHODS, type AssetConditionValue, type AssetStatusValue, type DepreciationMethodValue } from "@/lib/domain";
import { annualRate, computeDepreciation, defaultDecliningCoefficient } from "@/lib/depreciation";
import { formatMoney } from "@/lib/format";
import type { AssetFormValues } from "@/lib/asset-form-values";

export function AssetForm({
  options,
  initial,
  assetId,
  currency,
}: {
  options: AssetFormOptions;
  initial: AssetFormValues;
  assetId?: string;
  currency: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<AssetFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const set = <K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const onCategory = (categoryId: string) => {
    const cat = options.categories.find((c) => c.id === categoryId);
    setValues((v) => ({
      ...v,
      categoryId,
      ...(cat
        ? {
            depreciationMethod: cat.defaultMethod,
            usefulLifeYears: String(cat.defaultUsefulLifeYears),
            decliningCoefficient: cat.decliningCoefficient ? String(cat.decliningCoefficient) : "",
          }
        : {}),
    }));
  };

  const preview = useMemo(() => {
    const value = Number(values.acquisitionValue);
    const life = Number(values.usefulLifeYears);
    if (!value || !values.acquisitionDate) return null;
    const start = new Date(`${values.commissioningDate || values.acquisitionDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return null;
    const input = {
      acquisitionValue: value,
      residualValue: Number(values.residualValue) || 0,
      method: values.depreciationMethod,
      usefulLifeYears: life,
      decliningCoefficient: values.decliningCoefficient ? Number(values.decliningCoefficient) : null,
      startDate: start,
    };
    return { rate: annualRate(input), state: computeDepreciation(input, new Date()) };
  }, [values]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...values,
      quantity: Number(values.quantity) || 1,
      acquisitionValue: Number(values.acquisitionValue),
      usefulLifeYears: Number(values.usefulLifeYears) || 0,
      decliningCoefficient:
        values.depreciationMethod === "DECLINING" && values.decliningCoefficient ? Number(values.decliningCoefficient) : null,
      vatRate: values.vatRate === "" ? null : Number(values.vatRate),
      residualValue: Number(values.residualValue) || 0,
      commissioningDate: values.commissioningDate || null,
      warrantyEndDate: values.warrantyEndDate || null,
    };
    start(async () => {
      const res = assetId ? await updateAsset(assetId, payload) : await createAsset(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Enregistré.");
      router.push(`/assets/${res.data.id}`);
      router.refresh();
    });
  };

  const err = (k: string) => errors[k];

  return (
    <form onSubmit={submit} className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identification du bien</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Désignation" htmlFor="designation" required error={err("designation")} className="sm:col-span-2">
              <Input id="designation" value={values.designation} onChange={(e) => set("designation", e.target.value)} required maxLength={200} />
            </Field>
            <Field label="Catégorie comptable" htmlFor="categoryId" required error={err("categoryId")}>
              <NativeSelect id="categoryId" value={values.categoryId} onChange={(e) => onCategory(e.target.value)} required>
                <option value="">— Sélectionner —</option>
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.assetAccount} — {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Quantité (lot)" htmlFor="quantity" hint="1 pour un bien suivi individuellement." error={err("quantity")}>
              <Input id="quantity" type="number" min={1} value={values.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </Field>
            <Field label="Marque" htmlFor="brand">
              <Input id="brand" value={values.brand} onChange={(e) => set("brand", e.target.value)} />
            </Field>
            <Field label="Modèle" htmlFor="model">
              <Input id="model" value={values.model} onChange={(e) => set("model", e.target.value)} />
            </Field>
            <Field label="N° de série / châssis / IMEI" htmlFor="serialNumber" error={err("serialNumber")}>
              <Input id="serialNumber" value={values.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} />
            </Field>
            <Field label="Fournisseur" htmlFor="supplierId">
              <NativeSelect id="supplierId" value={values.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
                <option value="">—</option>
                {options.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Description / caractéristiques techniques" htmlFor="description" className="sm:col-span-2">
              <Textarea id="description" value={values.description} onChange={(e) => set("description", e.target.value)} rows={3} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Données financières & amortissement</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Date d'acquisition" htmlFor="acquisitionDate" required error={err("acquisitionDate")}>
              <Input id="acquisitionDate" type="date" value={values.acquisitionDate} onChange={(e) => set("acquisitionDate", e.target.value)} required />
            </Field>
            <Field label="Date de mise en service" htmlFor="commissioningDate" error={err("commissioningDate")} hint="Point de départ de l'amortissement.">
              <Input id="commissioningDate" type="date" value={values.commissioningDate} onChange={(e) => set("commissioningDate", e.target.value)} />
            </Field>
            <Field label={`Valeur d'origine HT (${currency})`} htmlFor="acquisitionValue" required error={err("acquisitionValue")}>
              <Input id="acquisitionValue" type="number" step="0.01" min={0} value={values.acquisitionValue} onChange={(e) => set("acquisitionValue", e.target.value)} required />
            </Field>
            <Field label="Taux de TVA (%)" htmlFor="vatRate">
              <NativeSelect id="vatRate" value={values.vatRate} onChange={(e) => set("vatRate", e.target.value)}>
                {VAT_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r} %
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Méthode d'amortissement" htmlFor="depreciationMethod">
              <NativeSelect
                id="depreciationMethod"
                value={values.depreciationMethod}
                onChange={(e) => set("depreciationMethod", e.target.value as DepreciationMethodValue)}
              >
                {DEPRECIATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {DEPRECIATION_METHOD_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Durée (années)" htmlFor="usefulLifeYears" error={err("usefulLifeYears")}>
              <Input
                id="usefulLifeYears"
                type="number"
                min={0}
                max={100}
                value={values.usefulLifeYears}
                onChange={(e) => set("usefulLifeYears", e.target.value)}
                disabled={values.depreciationMethod === "NONE"}
              />
            </Field>
            {values.depreciationMethod === "DECLINING" && (
              <Field
                label="Coefficient dégressif"
                htmlFor="decliningCoefficient"
                hint={`Par défaut : ${defaultDecliningCoefficient(Number(values.usefulLifeYears) || 0)} (barème fiscal).`}
              >
                <Input
                  id="decliningCoefficient"
                  type="number"
                  step="0.25"
                  min={1}
                  max={5}
                  value={values.decliningCoefficient}
                  onChange={(e) => set("decliningCoefficient", e.target.value)}
                />
              </Field>
            )}
            <Field label="Valeur résiduelle" htmlFor="residualValue" error={err("residualValue")}>
              <Input id="residualValue" type="number" step="0.01" min={0} value={values.residualValue} onChange={(e) => set("residualValue", e.target.value)} />
            </Field>
            <Field label="Fin de garantie" htmlFor="warrantyEndDate">
              <Input id="warrantyEndDate" type="date" value={values.warrantyEndDate} onChange={(e) => set("warrantyEndDate", e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Localisation & cycle de vie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Statut" htmlFor="status" error={err("status")}>
              <NativeSelect id="status" value={values.status} onChange={(e) => set("status", e.target.value as AssetStatusValue)}>
                {ASSET_STATUSES.filter((s) => s !== "DISPOSED").map((s) => (
                  <option key={s} value={s}>
                    {ASSET_STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="État physique" htmlFor="condition">
              <NativeSelect id="condition" value={values.condition} onChange={(e) => set("condition", e.target.value as AssetConditionValue)}>
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CONDITION_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Localisation" htmlFor="locationId">
              <NativeSelect id="locationId" value={values.locationId} onChange={(e) => set("locationId", e.target.value)}>
                <option value="">— Non localisé —</option>
                {options.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.path}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Direction / service" htmlFor="departmentId">
              <NativeSelect id="departmentId" value={values.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">—</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Centre de coût" htmlFor="costCenterId">
              <NativeSelect id="costCenterId" value={values.costCenterId} onChange={(e) => set("costCenterId", e.target.value)}>
                <option value="">—</option>
                {options.costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Notes internes" htmlFor="notes">
              <Textarea id="notes" value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </Field>
          </CardContent>
        </Card>

        {preview && (
          <Card className="border-primary/30 bg-accent/40">
            <CardContent className="space-y-1.5 p-4 text-sm">
              <p className="font-medium">Aperçu à ce jour</p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Taux annuel</span>
                <span className="tabular">{preview.rate.toFixed(2)} %</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Amortissements cumulés</span>
                <span className="tabular">{formatMoney(preview.state.accumulated, currency)}</span>
              </p>
              <p className="flex justify-between font-medium">
                <span>VNC</span>
                <span className="tabular">{formatMoney(preview.state.netBookValue, currency)}</span>
              </p>
            </CardContent>
          </Card>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          {assetId ? "Enregistrer les modifications" : "Créer la fiche immobilisation"}
        </Button>
      </div>
    </form>
  );
}
