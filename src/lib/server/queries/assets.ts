import "server-only";
import type { Company, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assetDepreciation, buildSchedule, computeDepreciation, toDepreciationInput } from "@/lib/depreciation";
import { ASSET_STATUSES, TAG_STATUSES, type AssetStatusValue, type TagStatusValue } from "@/lib/domain";
import { round2 } from "@/lib/utils";

export const PAGE_SIZE = 50;

export interface AssetFilters {
  q?: string;
  status?: string;
  category?: string;
  location?: string;
  tag?: string;
  page?: string;
}

export async function buildAssetWhere(companyId: string, f: AssetFilters): Promise<Prisma.AssetWhereInput> {
  const where: Prisma.AssetWhereInput = { companyId };
  const q = f.q?.trim();
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { designation: { contains: q, mode: "insensitive" } },
      { serialNumber: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { custodian: { lastName: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (f.status && (ASSET_STATUSES as readonly string[]).includes(f.status)) where.status = f.status as AssetStatusValue;
  else if (!f.status) where.status = { not: "DISPOSED" };
  if (f.tag && (TAG_STATUSES as readonly string[]).includes(f.tag)) where.tagStatus = f.tag as TagStatusValue;
  if (f.category) where.categoryId = f.category;
  if (f.location) {
    const loc = await prisma.location.findFirst({ where: { id: f.location, companyId }, select: { pathIds: true } });
    if (loc) where.location = { pathIds: { startsWith: loc.pathIds } };
  }
  return where;
}

export async function listAssets(company: Company, f: AssetFilters) {
  const where = await buildAssetWhere(company.id, f);
  const page = Math.max(1, Number.parseInt(f.page ?? "1", 10) || 1);
  const now = new Date();
  const [rows, total, financeRows] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { code: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        category: { select: { name: true, code: true } },
        location: { select: { path: true, name: true } },
        custodian: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      select: {
        acquisitionValue: true,
        residualValue: true,
        depreciationMethod: true,
        usefulLifeYears: true,
        decliningCoefficient: true,
        acquisitionDate: true,
        commissioningDate: true,
        disposalDate: true,
      },
    }),
  ]);
  let gross = 0;
  let nbv = 0;
  for (const a of financeRows) {
    gross += Number(a.acquisitionValue);
    nbv += assetDepreciation(a, now, company.fiscalYearStartMonth).netBookValue;
  }
  return {
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    totals: { gross: round2(gross), nbv: round2(nbv) },
    rows: rows.map((a) => {
      const dep = assetDepreciation(a, now, company.fiscalYearStartMonth);
      return {
        id: a.id,
        code: a.code,
        designation: a.designation,
        brand: a.brand,
        model: a.model,
        serialNumber: a.serialNumber,
        category: a.category.name,
        location: a.location?.path ?? null,
        locationName: a.location?.name ?? null,
        custodian: a.custodian ? `${a.custodian.firstName} ${a.custodian.lastName}` : null,
        status: a.status,
        tagStatus: a.tagStatus,
        gross: Number(a.acquisitionValue),
        nbv: dep.netBookValue,
      };
    }),
  };
}

export async function getAssetFormOptions(companyId: string) {
  const [categories, locations, departments, costCenters, suppliers, employees] = await Promise.all([
    prisma.assetCategory.findMany({
      where: { companyId, active: true },
      orderBy: { assetAccount: "asc" },
      select: { id: true, code: true, name: true, assetAccount: true, defaultMethod: true, defaultUsefulLifeYears: true, decliningCoefficient: true },
    }),
    prisma.location.findMany({ where: { companyId, active: true }, orderBy: { path: "asc" }, select: { id: true, path: true, type: true, code: true, depth: true } }),
    prisma.department.findMany({ where: { companyId, active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.costCenter.findMany({ where: { companyId, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.supplier.findMany({ where: { companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.employee.findMany({
      where: { companyId, active: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, matricule: true, firstName: true, lastName: true, jobTitle: true },
    }),
  ]);
  return {
    categories: categories.map((c) => ({ ...c, decliningCoefficient: c.decliningCoefficient ? Number(c.decliningCoefficient) : null })),
    locations,
    departments,
    costCenters,
    suppliers,
    employees,
  };
}

export type AssetFormOptions = Awaited<ReturnType<typeof getAssetFormOptions>>;

export async function getAssetDetail(company: Company, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, companyId: company.id },
    include: {
      category: true,
      supplier: true,
      invoice: { select: { id: true, number: true, invoiceDate: true, fileName: true } },
      location: true,
      department: true,
      costCenter: true,
      custodian: true,
      createdBy: { select: { name: true } },
      integratedFrom: { select: { tempTag: true, campaign: { select: { id: true, code: true } } } },
      assignments: {
        orderBy: { assignedAt: "desc" },
        include: { employee: true, assignedBy: { select: { name: true } } },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          user: { select: { name: true } },
          fromLocation: { select: { path: true } },
          toLocation: { select: { path: true } },
          campaign: { select: { id: true, code: true } },
        },
      },
    },
  });
  if (!asset) return null;
  const input = toDepreciationInput(asset, company.fiscalYearStartMonth);
  const schedule = buildSchedule(input);
  const state = computeDepreciation(input, new Date());
  return { asset, schedule, state };
}
