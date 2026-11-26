/** Editable invoice draft shared by the review page (server) and the review UI (client). */
import { uniqueId } from "@/lib/utils";

export interface LineDraft {
  key: string;
  designation: string;
  specifications: string;
  brand: string;
  model: string;
  serials: string;
  quantity: string;
  unitPriceHT: string;
  vatRate: string;
  isFixedAsset: boolean;
  splitIntoUnits: boolean;
  categoryId: string;
  aiCategoryCode: string | null;
  aiConfidence: number | null;
  rationale: string | null;
  warnings: string[];
  belowThreshold: boolean;
}

export interface ReviewDraft {
  supplier: { name: string; ice: string; taxId: string; tradeRegister: string; address: string };
  number: string;
  invoiceDate: string;
  currency: string;
  totalHT: string;
  totalVAT: string;
  totalTTC: string;
  lines: LineDraft[];
}

export function emptyLine(): LineDraft {
  return {
    key: uniqueId(),
    designation: "",
    specifications: "",
    brand: "",
    model: "",
    serials: "",
    quantity: "1",
    unitPriceHT: "0",
    vatRate: "20",
    isFixedAsset: true,
    splitIntoUnits: true,
    categoryId: "",
    aiCategoryCode: null,
    aiConfidence: null,
    rationale: null,
    warnings: [],
    belowThreshold: false,
  };
}
