import type {
  AssetConditionValue,
  AssetStatusValue,
  CampaignStatusValue,
  ReconciliationCategoryValue,
  ResolutionStatusValue,
} from "@/lib/domain";
import type { ReconciliationSummary } from "@/lib/reconciliation";

export interface ReconRow {
  id: string;
  category: ReconciliationCategoryValue;
  assetId: string | null;
  surplusId: string | null;
  assetCode: string;
  designation: string;
  categoryName: string | null;
  serialNumber: string | null;
  expectedLocationPath: string | null;
  foundLocationPath: string | null;
  expectedStatus: AssetStatusValue | null;
  condition: AssetConditionValue | null;
  grossValue: number;
  netBookValue: number;
  reasons: string[];
  resolution: ResolutionStatusValue;
  resolutionAction: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  photoKey: string | null;
}

export interface ReconciliationReport {
  generatedAt: string;
  company: {
    name: string;
    legalName: string | null;
    ice: string | null;
    taxId: string | null;
    tradeRegister: string | null;
    address: string | null;
    city: string | null;
    currency: string;
  };
  campaign: {
    id: string;
    code: string;
    name: string;
    status: CampaignStatusValue;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    launchedAt: string | null;
    countClosedAt: string | null;
    reconciledAt: string | null;
    validatedAt: string | null;
    pvNumber: string | null;
    pvObservations: string | null;
    scope: string[];
    categories: string[];
    team: { name: string; role: string }[];
    createdBy: string;
    validatedBy: string | null;
    scansCount: number;
  };
  summary: ReconciliationSummary;
  rows: ReconRow[];
}

export const RESOLUTION_ACTION_LABELS: Record<string, string> = {
  CONFORME: "Conforme",
  LOCATION_SYNCED: "Localisation synchronisée",
  DECLARED_MISSING: "Déclaré disparu",
  INTEGRATED: "Intégré à l'actif",
  REJECTED: "Rejeté (bien de tiers…)",
  JUSTIFIED: "Justifié",
};
