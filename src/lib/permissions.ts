import type { UserRoleValue } from "@/lib/domain";

const ALL: UserRoleValue[] = ["ADMIN", "ACCOUNTANT", "AUDITOR", "VIEWER"];
const FINANCE: UserRoleValue[] = ["ADMIN", "ACCOUNTANT"];
const FIELD: UserRoleValue[] = ["ADMIN", "ACCOUNTANT", "AUDITOR"];

export const PERMISSIONS = {
  "asset:read": ALL,
  "asset:write": FINANCE,
  "asset:transfer": FINANCE,
  "asset:assign": FINANCE,
  "asset:dispose": FINANCE,
  "asset:import": FINANCE,
  "label:print": FIELD,
  "invoice:read": FINANCE,
  "invoice:import": FINANCE,
  "invoice:validate": FINANCE,
  "campaign:read": ALL,
  "campaign:manage": FINANCE,
  "campaign:scan": FIELD,
  "reconcile:resolve": FINANCE,
  "campaign:validate": FINANCE,
  "location:write": FINANCE,
  "referential:write": FINANCE,
  "audit:read": FIELD,
  "company:manage": ["ADMIN"] as UserRoleValue[],
  "user:manage": ["ADMIN"] as UserRoleValue[],
} as const satisfies Record<string, readonly UserRoleValue[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRoleValue, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRoleValue[]).includes(role);
}
