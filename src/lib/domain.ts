/**
 * Client-safe domain types mirroring the Prisma enums (type-only import, nothing
 * from @prisma/client is bundled in the browser).
 */
import type { $Enums } from "@prisma/client";

export type UserRoleValue = $Enums.UserRole;
export type LocationTypeValue = $Enums.LocationType;
export type DepreciationMethodValue = $Enums.DepreciationMethod;
export type AssetStatusValue = $Enums.AssetStatus;
export type AssetConditionValue = $Enums.AssetCondition;
export type TagStatusValue = $Enums.TagStatus;
export type AssetOriginValue = $Enums.AssetOrigin;
export type DisposalTypeValue = $Enums.DisposalType;
export type AssetEventTypeValue = $Enums.AssetEventType;
export type InvoiceStatusValue = $Enums.InvoiceStatus;
export type CampaignStatusValue = $Enums.CampaignStatus;
export type ReconciliationCategoryValue = $Enums.ReconciliationCategory;
export type ResolutionStatusValue = $Enums.ResolutionStatus;
export type SurplusStatusValue = $Enums.SurplusStatus;

export const ASSET_STATUSES = ["IN_SERVICE", "IN_STOCK", "UNDER_MAINTENANCE", "DISPOSED", "MISSING"] as const satisfies readonly AssetStatusValue[];
export const ASSET_CONDITIONS = ["GOOD", "DAMAGED", "TO_REPAIR"] as const satisfies readonly AssetConditionValue[];
export const TAG_STATUSES = ["UNTAGGED", "PRINTED", "AFFIXED"] as const satisfies readonly TagStatusValue[];
export const LOCATION_TYPES = ["SITE", "BUILDING", "FLOOR", "DEPARTMENT", "ZONE", "ROOM"] as const satisfies readonly LocationTypeValue[];
export const DEPRECIATION_METHODS = ["LINEAR", "DECLINING", "NONE"] as const satisfies readonly DepreciationMethodValue[];
export const DISPOSAL_TYPES = ["SALE", "DESTRUCTION", "DONATION", "THEFT_LOSS"] as const satisfies readonly DisposalTypeValue[];
export const USER_ROLES = ["ADMIN", "ACCOUNTANT", "AUDITOR", "VIEWER"] as const satisfies readonly UserRoleValue[];
export const RECON_CATEGORIES = ["MATCH", "MISPLACED", "MISSING", "SURPLUS"] as const satisfies readonly ReconciliationCategoryValue[];
