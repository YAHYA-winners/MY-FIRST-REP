import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { SettingsPanels, type SettingsData } from "@/components/settings/settings-panels";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const { user, company, companies } = await requirePageContext("asset:read");
  const canManageUsers = can(user.role, "user:manage");
  const [categories, costCenters, departments, employees, suppliers, users] = await Promise.all([
    prisma.assetCategory.findMany({ where: { companyId: company.id }, orderBy: { assetAccount: "asc" }, include: { _count: { select: { assets: true } } } }),
    prisma.costCenter.findMany({ where: { companyId: company.id }, orderBy: { code: "asc" } }),
    prisma.department.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" }, include: { costCenter: { select: { code: true, name: true } } } }),
    prisma.employee.findMany({ where: { companyId: company.id }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { department: { select: { name: true } } } }),
    prisma.supplier.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" } }),
    canManageUsers
      ? prisma.user.findMany({
          where: { memberships: { some: { companyId: { in: companies.map((c) => c.id) } } } },
          orderBy: { name: "asc" },
          include: { memberships: { select: { companyId: true } } },
        })
      : Promise.resolve([]),
  ]);
  const data: SettingsData = {
    company: {
      name: company.name,
      legalName: company.legalName,
      legalForm: company.legalForm,
      ice: company.ice,
      taxId: company.taxId,
      tradeRegister: company.tradeRegister,
      address: company.address,
      city: company.city,
      currency: company.currency,
      capitalizationThreshold: Number(company.capitalizationThreshold),
      fiscalYearStartMonth: company.fiscalYearStartMonth,
    },
    categories: categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      assetAccount: c.assetAccount,
      depreciationAccount: c.depreciationAccount,
      defaultMethod: c.defaultMethod,
      defaultUsefulLifeYears: c.defaultUsefulLifeYears,
      decliningCoefficient: c.decliningCoefficient ? Number(c.decliningCoefficient) : null,
      trackPhysically: c.trackPhysically,
      active: c.active,
      assetCount: c._count.assets,
    })),
    costCenters: costCenters.map((c) => ({ id: c.id, code: c.code, name: c.name, active: c.active })),
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      costCenterId: d.costCenterId,
      costCenterLabel: d.costCenter ? `${d.costCenter.code} — ${d.costCenter.name}` : null,
      managerName: d.managerName,
      active: d.active,
    })),
    employees: employees.map((e) => ({
      id: e.id,
      matricule: e.matricule,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      phone: e.phone,
      jobTitle: e.jobTitle,
      departmentId: e.departmentId,
      departmentName: e.department?.name ?? null,
      active: e.active,
    })),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, ice: s.ice, taxId: s.taxId, tradeRegister: s.tradeRegister, address: s.address, city: s.city, email: s.email, phone: s.phone })),
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      companyIds: u.memberships.map((m) => m.companyId),
    })),
    companies: companies.map((c) => ({ id: c.id, name: c.name })),
  };
  return (
    <div>
      <PageHeader title="Paramètres & référentiels" description={`Société active : ${company.name}`} />
      <SettingsPanels
        data={data}
        canEditReferentials={can(user.role, "referential:write")}
        canManageCompany={can(user.role, "company:manage")}
        canManageUsers={canManageUsers}
      />
    </div>
  );
}
