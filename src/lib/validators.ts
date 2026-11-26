import { z } from "zod";
import {
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  DEPRECIATION_METHODS,
  DISPOSAL_TYPES,
  LOCATION_TYPES,
  USER_ROLES,
} from "@/lib/domain";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const optText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max, `${max} caractères maximum`)
    .nullish()
    .transform((v) => (v ? v : null));

export const reqText = (max = 255, label = "Ce champ") =>
  z.string({ required_error: `${label} est obligatoire` }).trim().min(1, `${label} est obligatoire`).max(max, `${max} caractères maximum`);

export const id = z.string().trim().min(1).max(64);
export const optId = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => (v ? v : null));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const dateStr = z
  .string({ required_error: "Date obligatoire" })
  .regex(ISO_DATE, "Date invalide (AAAA-MM-JJ)")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Date invalide");

export const optDateStr = z
  .string()
  .nullish()
  .transform((s, ctx) => {
    if (!s) return null;
    if (!ISO_DATE.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date invalide (AAAA-MM-JJ)" });
      return z.NEVER;
    }
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date invalide" });
      return z.NEVER;
    }
    return d;
  });

export const money = z.coerce.number({ invalid_type_error: "Montant invalide" }).finite().min(0, "Montant négatif").max(1e12);
export const optMoney = z
  .union([z.coerce.number().finite().min(0).max(1e12), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v === "" || v === null || v === undefined ? null : v));

const iceRegex = /^\d{15}$/;
export const optIce = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.replace(/\s+/g, "") : null))
  .refine((v) => v === null || iceRegex.test(v), "L'ICE doit comporter 15 chiffres");

// ---------------------------------------------------------------------------
// Auth & users
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe obligatoire").max(200),
});

export const userSchema = z.object({
  id: optId,
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  name: reqText(120, "Le nom"),
  role: z.enum(USER_ROLES),
  active: z.boolean().default(true),
  password: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || v.length >= 10, "10 caractères minimum")
    .refine((v) => v === null || (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)), "Majuscule, minuscule et chiffre requis"),
  companyIds: z.array(id).min(1, "Au moins une société"),
});

export const companySchema = z.object({
  name: reqText(160, "La raison sociale"),
  legalName: optText(200),
  legalForm: optText(40),
  ice: optIce,
  taxId: optText(40),
  tradeRegister: optText(40),
  address: optText(300),
  city: optText(80),
  currency: z.string().trim().length(3).toUpperCase(),
  capitalizationThreshold: money,
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});

// ---------------------------------------------------------------------------
// Referentials
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  id: optId,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, "2 à 20 caractères : lettres, chiffres, _"),
  name: reqText(120, "Le libellé"),
  description: optText(500),
  assetAccount: z.string().trim().regex(/^\d{3,10}$/, "Compte numérique attendu"),
  depreciationAccount: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{3,10}$/.test(v), "Compte numérique attendu"),
  defaultMethod: z.enum(DEPRECIATION_METHODS),
  defaultUsefulLifeYears: z.coerce.number().int().min(0).max(100),
  decliningCoefficient: optMoney,
  trackPhysically: z.boolean().default(true),
  active: z.boolean().default(true),
});

export const costCenterSchema = z.object({
  id: optId,
  code: reqText(30, "Le code").transform((v) => v.toUpperCase()),
  name: reqText(120, "Le libellé"),
  active: z.boolean().default(true),
});

export const departmentSchema = z.object({
  id: optId,
  code: reqText(30, "Le code").transform((v) => v.toUpperCase()),
  name: reqText(120, "Le libellé"),
  costCenterId: optId,
  managerName: optText(120),
  active: z.boolean().default(true),
});

export const employeeSchema = z.object({
  id: optId,
  matricule: reqText(30, "Le matricule"),
  firstName: reqText(80, "Le prénom"),
  lastName: reqText(80, "Le nom"),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Adresse e-mail invalide"),
  phone: optText(30),
  jobTitle: optText(120),
  departmentId: optId,
  active: z.boolean().default(true),
});

export const supplierSchema = z.object({
  id: optId,
  name: reqText(200, "La raison sociale"),
  ice: optIce,
  taxId: optText(40),
  tradeRegister: optText(40),
  address: optText(300),
  city: optText(80),
  email: optText(160),
  phone: optText(40),
});

export const locationSchema = z.object({
  id: optId,
  parentId: optId,
  type: z.enum(LOCATION_TYPES),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.\-]{0,39}$/, "Code : lettres, chiffres, - _ . (40 max)"),
  name: reqText(120, "Le libellé"),
  departmentId: optId,
  address: optText(300),
  active: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const assetSchema = z
  .object({
    designation: reqText(200, "La désignation"),
    description: optText(2000),
    brand: optText(80),
    model: optText(120),
    serialNumber: optText(120),
    quantity: z.coerce.number().int().min(1).max(100000).default(1),
    categoryId: id,
    supplierId: optId,
    acquisitionDate: dateStr,
    commissioningDate: optDateStr,
    acquisitionValue: money,
    vatRate: optMoney,
    depreciationMethod: z.enum(DEPRECIATION_METHODS),
    usefulLifeYears: z.coerce.number().int().min(0).max(100),
    decliningCoefficient: optMoney,
    residualValue: money.default(0),
    status: z.enum(ASSET_STATUSES).refine((s) => s !== "DISPOSED", "Utilisez la procédure de sortie d'actif"),
    condition: z.enum(ASSET_CONDITIONS),
    locationId: optId,
    departmentId: optId,
    costCenterId: optId,
    warrantyEndDate: optDateStr,
    notes: optText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.commissioningDate && v.commissioningDate < v.acquisitionDate) {
      ctx.addIssue({ code: "custom", path: ["commissioningDate"], message: "Antérieure à la date d'acquisition" });
    }
    if (v.residualValue > v.acquisitionValue) {
      ctx.addIssue({ code: "custom", path: ["residualValue"], message: "Supérieure à la valeur d'origine" });
    }
    if (v.depreciationMethod !== "NONE" && v.usefulLifeYears < 1) {
      ctx.addIssue({ code: "custom", path: ["usefulLifeYears"], message: "Durée d'amortissement requise" });
    }
  });

export type AssetInput = z.input<typeof assetSchema>;

export const transferSchema = z.object({
  assetIds: z.array(id).min(1).max(5000),
  locationId: id,
  departmentId: optId,
  costCenterId: optId,
  reason: optText(500),
});

export const statusChangeSchema = z.object({
  assetId: id,
  status: z.enum(ASSET_STATUSES).refine((s) => s !== "DISPOSED", "Utilisez la procédure de sortie d'actif"),
  condition: z.enum(ASSET_CONDITIONS).nullish(),
  reason: reqText(500, "Le motif"),
});

export const disposalSchema = z.object({
  assetId: id,
  disposalDate: dateStr,
  disposalType: z.enum(DISPOSAL_TYPES),
  disposalValue: optMoney,
  reason: reqText(500, "Le motif"),
});

export const assignmentSchema = z.object({
  assetId: id,
  employeeId: id,
  condition: z.enum(ASSET_CONDITIONS),
  signerName: reqText(160, "Le nom du signataire"),
  signatureDataUrl: z
    .string()
    .max(2_000_000, "Signature trop volumineuse")
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Signature invalide"),
  notes: optText(1000),
});

export const returnSchema = z.object({
  assetId: id,
  condition: z.enum(ASSET_CONDITIONS),
  notes: optText(1000),
});

export const importRowSchema = z.object({
  rowNumber: z.number().int(),
  code: optText(40),
  designation: reqText(200, "La désignation"),
  categoryCode: reqText(20, "Le code catégorie"),
  brand: optText(80),
  model: optText(120),
  serialNumber: optText(120),
  quantity: z.coerce.number().int().min(1).default(1),
  acquisitionDate: dateStr,
  commissioningDate: optDateStr,
  acquisitionValue: money,
  depreciationMethod: z.enum(DEPRECIATION_METHODS).nullish(),
  usefulLifeYears: z.coerce.number().int().min(0).max(100).nullish(),
  locationCode: optText(40),
  costCenterCode: optText(30),
  custodianMatricule: optText(30),
  supplierName: optText(200),
  status: z.enum(ASSET_STATUSES).nullish(),
  notes: optText(2000),
});

export type ImportRowInput = z.input<typeof importRowSchema>;

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const invoiceLineApprovalSchema = z.object({
  designation: reqText(300, "La désignation"),
  specifications: optText(2000),
  brand: optText(80),
  model: optText(120),
  serialNumbers: z.array(z.string().trim().min(1).max(120)).max(10000).default([]),
  quantity: z.coerce.number().positive("Quantité > 0").max(100000),
  unitPriceHT: money,
  vatRate: z.coerce.number().min(0).max(100),
  isFixedAsset: z.boolean(),
  splitIntoUnits: z.boolean(),
  categoryId: optId,
  aiCategoryCode: optText(40),
  aiConfidence: z.number().min(0).max(1).nullish(),
});

export const invoiceApprovalSchema = z
  .object({
    invoiceId: id,
    supplier: z.object({
      name: reqText(200, "Le fournisseur"),
      ice: optIce,
      taxId: optText(40),
      tradeRegister: optText(40),
      address: optText(300),
    }),
    number: reqText(80, "Le numéro de facture"),
    invoiceDate: dateStr,
    currency: z.string().trim().length(3).toUpperCase(),
    totalHT: money,
    totalVAT: money,
    totalTTC: money,
    commissioningDate: optDateStr,
    defaultLocationId: optId,
    defaultCostCenterId: optId,
    defaultDepartmentId: optId,
    initialStatus: z.enum(["IN_SERVICE", "IN_STOCK"]),
    allowDuplicate: z.boolean().default(false),
    lines: z.array(invoiceLineApprovalSchema).min(1, "Au moins une ligne"),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((line, i) => {
      if (line.isFixedAsset && !line.categoryId) {
        ctx.addIssue({ code: "custom", path: ["lines", i, "categoryId"], message: "Catégorie comptable requise" });
      }
      if (line.isFixedAsset && line.splitIntoUnits && !Number.isInteger(line.quantity)) {
        ctx.addIssue({ code: "custom", path: ["lines", i, "quantity"], message: "Quantité entière requise pour scinder" });
      }
    });
  });

export type InvoiceApprovalInput = z.input<typeof invoiceApprovalSchema>;

// ---------------------------------------------------------------------------
// Campaigns & field inventory
// ---------------------------------------------------------------------------

export const campaignSchema = z
  .object({
    name: reqText(160, "Le libellé"),
    description: optText(2000),
    plannedStartDate: optDateStr,
    plannedEndDate: optDateStr,
    locationIds: z.array(id).max(500),
    categoryIds: z.array(id).max(200),
    memberIds: z.array(id).max(200),
    leadId: optId,
  })
  .superRefine((v, ctx) => {
    if (v.plannedStartDate && v.plannedEndDate && v.plannedEndDate < v.plannedStartDate) {
      ctx.addIssue({ code: "custom", path: ["plannedEndDate"], message: "Antérieure à la date de début" });
    }
  });

export type CampaignInput = z.input<typeof campaignSchema>;

const gps = {
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  gpsAccuracy: z.number().min(0).max(100000).nullish(),
};

export const scanSchema = z.object({
  clientId: z.string().min(8).max(64),
  code: z.string().trim().min(1).max(500),
  locationId: id,
  condition: z.enum(ASSET_CONDITIONS),
  transferProposed: z.boolean().default(false),
  manualEntry: z.boolean().default(false),
  photoKey: optText(300),
  notes: optText(1000),
  scannedAt: z.coerce.date(),
  deviceInfo: optText(300),
  ...gps,
});

export type ScanInput = z.input<typeof scanSchema>;

export const surplusSchema = z.object({
  clientId: z.string().min(8).max(64),
  scannedCode: optText(500),
  designation: reqText(200, "La désignation"),
  description: optText(1000),
  brand: optText(80),
  model: optText(120),
  serialNumber: optText(120),
  categoryId: optId,
  estimatedValue: optMoney,
  condition: z.enum(ASSET_CONDITIONS),
  locationId: id,
  photoKey: optText(300),
  notes: optText(1000),
  foundAt: z.coerce.date(),
  ...gps,
});

export type SurplusInput = z.input<typeof surplusSchema>;

export const integrateSurplusSchema = z.object({
  campaignId: id,
  resultId: id,
  designation: reqText(200, "La désignation"),
  categoryId: id,
  acquisitionValue: money,
  acquisitionDate: dateStr,
  brand: optText(80),
  model: optText(120),
  serialNumber: optText(120),
  note: optText(1000),
});
