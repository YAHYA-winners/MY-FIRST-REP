import type {
  AssetConditionValue,
  AssetEventTypeValue,
  AssetOriginValue,
  AssetStatusValue,
  CampaignStatusValue,
  DepreciationMethodValue,
  DisposalTypeValue,
  InvoiceStatusValue,
  LocationTypeValue,
  ReconciliationCategoryValue,
  ResolutionStatusValue,
  SurplusStatusValue,
  TagStatusValue,
  UserRoleValue,
} from "@/lib/domain";

export type Tone = "default" | "secondary" | "success" | "warning" | "destructive" | "info" | "muted";

export const ASSET_STATUS_LABELS: Record<AssetStatusValue, string> = {
  IN_SERVICE: "En service",
  IN_STOCK: "En stock / Non affecté",
  UNDER_MAINTENANCE: "En maintenance / Panne",
  DISPOSED: "Mis au rebut",
  MISSING: "Disparu / Écart négatif",
};

export const ASSET_STATUS_TONES: Record<AssetStatusValue, Tone> = {
  IN_SERVICE: "success",
  IN_STOCK: "info",
  UNDER_MAINTENANCE: "warning",
  DISPOSED: "muted",
  MISSING: "destructive",
};

export const ASSET_CONDITION_LABELS: Record<AssetConditionValue, string> = {
  GOOD: "Bon état",
  DAMAGED: "Endommagé",
  TO_REPAIR: "À réparer",
};

export const ASSET_CONDITION_TONES: Record<AssetConditionValue, Tone> = {
  GOOD: "success",
  DAMAGED: "destructive",
  TO_REPAIR: "warning",
};

export const TAG_STATUS_LABELS: Record<TagStatusValue, string> = {
  UNTAGGED: "Non étiqueté",
  PRINTED: "Étiquette imprimée",
  AFFIXED: "Étiquette posée",
};

export const TAG_STATUS_TONES: Record<TagStatusValue, Tone> = {
  UNTAGGED: "warning",
  PRINTED: "info",
  AFFIXED: "success",
};

export const LOCATION_TYPE_LABELS: Record<LocationTypeValue, string> = {
  SITE: "Site / Agence",
  BUILDING: "Bâtiment",
  FLOOR: "Étage",
  DEPARTMENT: "Direction / Service",
  ZONE: "Zone",
  ROOM: "Bureau / Local",
};

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethodValue, string> = {
  LINEAR: "Linéaire",
  DECLINING: "Dégressif",
  NONE: "Non amortissable",
};

export const DISPOSAL_TYPE_LABELS: Record<DisposalTypeValue, string> = {
  SALE: "Cession",
  DESTRUCTION: "Destruction / Mise au rebut",
  DONATION: "Don",
  THEFT_LOSS: "Vol / Perte",
};

export const ASSET_ORIGIN_LABELS: Record<AssetOriginValue, string> = {
  INVOICE: "Facture (IA)",
  MANUAL: "Saisie manuelle",
  IMPORT: "Import fichier",
  SURPLUS: "Excédent d'inventaire",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  UPLOADED: "En attente d'extraction",
  EXTRACTING: "Extraction en cours",
  EXTRACTED: "À vérifier",
  FAILED: "Échec d'extraction",
  VALIDATED: "Validée",
  REJECTED: "Rejetée",
};

export const INVOICE_STATUS_TONES: Record<InvoiceStatusValue, Tone> = {
  UPLOADED: "muted",
  EXTRACTING: "info",
  EXTRACTED: "warning",
  FAILED: "destructive",
  VALIDATED: "success",
  REJECTED: "secondary",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatusValue, string> = {
  DRAFT: "Préparation",
  IN_PROGRESS: "Comptage en cours",
  COUNT_CLOSED: "Comptage clôturé",
  VALIDATED: "PV validé",
};

export const CAMPAIGN_STATUS_TONES: Record<CampaignStatusValue, Tone> = {
  DRAFT: "muted",
  IN_PROGRESS: "info",
  COUNT_CLOSED: "warning",
  VALIDATED: "success",
};

export const RECON_CATEGORY_LABELS: Record<ReconciliationCategoryValue, string> = {
  MATCH: "Conformes",
  MISPLACED: "Déplacés",
  MISSING: "Manquants",
  SURPLUS: "Surplus",
};

export const RECON_CATEGORY_LONG_LABELS: Record<ReconciliationCategoryValue, string> = {
  MATCH: "Match parfait (Conformes)",
  MISPLACED: "Écarts de localisation / affectation (Déplacés)",
  MISSING: "Écarts négatifs (Manquants / Non retrouvés)",
  SURPLUS: "Écarts positifs (Surplus / Excédents)",
};

export const RECON_CATEGORY_TONES: Record<ReconciliationCategoryValue, Tone> = {
  MATCH: "success",
  MISPLACED: "warning",
  MISSING: "destructive",
  SURPLUS: "info",
};

export const RESOLUTION_STATUS_LABELS: Record<ResolutionStatusValue, string> = {
  OPEN: "À traiter",
  RESOLVED: "Régularisé",
  IGNORED: "Classé sans suite",
};

export const SURPLUS_STATUS_LABELS: Record<SurplusStatusValue, string> = {
  PENDING: "À régulariser",
  INTEGRATED: "Intégré à l'actif",
  REJECTED: "Rejeté",
};

export const EVENT_TYPE_LABELS: Record<AssetEventTypeValue, string> = {
  CREATED: "Création",
  UPDATED: "Modification",
  INVOICE_LINKED: "Rattachement facture",
  LOCATION_TRANSFER: "Transfert de localisation",
  CUSTODIAN_ASSIGNED: "Affectation collaborateur",
  CUSTODIAN_RETURNED: "Restitution",
  STATUS_CHANGE: "Changement de statut",
  CONDITION_CHANGE: "Changement d'état",
  TAG_PRINTED: "Étiquette imprimée",
  TAG_AFFIXED: "Étiquette posée",
  SCANNED: "Scan inventaire",
  DISPOSED: "Sortie d'actif",
  RECONCILIATION_ADJUSTMENT: "Régularisation inventaire",
};

export const ROLE_LABELS: Record<UserRoleValue, string> = {
  ADMIN: "Administrateur",
  ACCOUNTANT: "Comptable / Contrôle de gestion",
  AUDITOR: "Inventoriste / Auditeur",
  VIEWER: "Lecture seule",
};

export const VAT_RATES = [20, 14, 10, 7, 0] as const;
