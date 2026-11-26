/** Asset form values shared by server pages (initial values) and the client form. */
import type { AssetConditionValue, AssetStatusValue, DepreciationMethodValue } from "@/lib/domain";
import { todayInput } from "@/lib/format";

export interface AssetFormValues {
  designation: string;
  description: string;
  brand: string;
  model: string;
  serialNumber: string;
  quantity: string;
  categoryId: string;
  supplierId: string;
  acquisitionDate: string;
  commissioningDate: string;
  acquisitionValue: string;
  vatRate: string;
  depreciationMethod: DepreciationMethodValue;
  usefulLifeYears: string;
  decliningCoefficient: string;
  residualValue: string;
  status: AssetStatusValue;
  condition: AssetConditionValue;
  locationId: string;
  departmentId: string;
  costCenterId: string;
  warrantyEndDate: string;
  notes: string;
}

export function emptyAssetValues(): AssetFormValues {
  return {
    designation: "",
    description: "",
    brand: "",
    model: "",
    serialNumber: "",
    quantity: "1",
    categoryId: "",
    supplierId: "",
    acquisitionDate: todayInput(),
    commissioningDate: todayInput(),
    acquisitionValue: "",
    vatRate: "20",
    depreciationMethod: "LINEAR",
    usefulLifeYears: "5",
    decliningCoefficient: "",
    residualValue: "0",
    status: "IN_SERVICE",
    condition: "GOOD",
    locationId: "",
    departmentId: "",
    costCenterId: "",
    warrantyEndDate: "",
    notes: "",
  };
}
