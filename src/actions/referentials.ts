"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import {
  categorySchema,
  companySchema,
  costCenterSchema,
  departmentSchema,
  employeeSchema,
  supplierSchema,
  userSchema,
} from "@/lib/validators";
import { hashPassword, requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { assertCompanyRefs } from "@/lib/server/guards";

function refresh() {
  revalidatePath("/settings");
}

export async function saveCategory(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("referential:write");
    const data = categorySchema.parse(input);
    const payload = {
      code: data.code,
      name: data.name,
      description: data.description,
      assetAccount: data.assetAccount,
      depreciationAccount: data.depreciationAccount,
      defaultMethod: data.defaultMethod,
      defaultUsefulLifeYears: data.defaultMethod === "NONE" ? 0 : data.defaultUsefulLifeYears,
      decliningCoefficient: data.defaultMethod === "DECLINING" ? data.decliningCoefficient : null,
      trackPhysically: data.trackPhysically,
      active: data.active,
    };
    if (data.id) {
      const { count } = await prisma.assetCategory.updateMany({ where: { id: data.id, companyId: company.id }, data: payload });
      if (!count) throw new AppError("Catégorie introuvable.", 404);
    } else {
      await prisma.assetCategory.create({ data: { ...payload, companyId: company.id } });
    }
    refresh();
    return null;
  }, "Catégorie enregistrée.");
}

export async function saveCostCenter(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("referential:write");
    const data = costCenterSchema.parse(input);
    const payload = { code: data.code, name: data.name, active: data.active };
    if (data.id) {
      const { count } = await prisma.costCenter.updateMany({ where: { id: data.id, companyId: company.id }, data: payload });
      if (!count) throw new AppError("Centre de coût introuvable.", 404);
    } else {
      await prisma.costCenter.create({ data: { ...payload, companyId: company.id } });
    }
    refresh();
    return null;
  }, "Centre de coût enregistré.");
}

export async function saveDepartment(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("referential:write");
    const data = departmentSchema.parse(input);
    await assertCompanyRefs(company.id, { costCenterId: data.costCenterId });
    const payload = {
      code: data.code,
      name: data.name,
      costCenterId: data.costCenterId,
      managerName: data.managerName,
      active: data.active,
    };
    if (data.id) {
      const { count } = await prisma.department.updateMany({ where: { id: data.id, companyId: company.id }, data: payload });
      if (!count) throw new AppError("Direction introuvable.", 404);
    } else {
      await prisma.department.create({ data: { ...payload, companyId: company.id } });
    }
    refresh();
    return null;
  }, "Direction / service enregistré.");
}

export async function saveEmployee(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("referential:write");
    const data = employeeSchema.parse(input);
    await assertCompanyRefs(company.id, { departmentId: data.departmentId });
    const payload = {
      matricule: data.matricule,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      jobTitle: data.jobTitle,
      departmentId: data.departmentId,
      active: data.active,
    };
    if (data.id) {
      const { count } = await prisma.employee.updateMany({ where: { id: data.id, companyId: company.id }, data: payload });
      if (!count) throw new AppError("Collaborateur introuvable.", 404);
    } else {
      await prisma.employee.create({ data: { ...payload, companyId: company.id } });
    }
    refresh();
    return null;
  }, "Collaborateur enregistré.");
}

export async function saveSupplier(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("referential:write");
    const data = supplierSchema.parse(input);
    const payload = {
      name: data.name,
      ice: data.ice,
      taxId: data.taxId,
      tradeRegister: data.tradeRegister,
      address: data.address,
      city: data.city,
      email: data.email,
      phone: data.phone,
    };
    if (data.ice) {
      const duplicate = await prisma.supplier.findFirst({
        where: { companyId: company.id, ice: data.ice, ...(data.id ? { id: { not: data.id } } : {}) },
      });
      if (duplicate) throw new AppError(`Un fournisseur porte déjà l'ICE ${data.ice} (${duplicate.name}).`);
    }
    if (data.id) {
      const { count } = await prisma.supplier.updateMany({ where: { id: data.id, companyId: company.id }, data: payload });
      if (!count) throw new AppError("Fournisseur introuvable.", 404);
    } else {
      await prisma.supplier.create({ data: { ...payload, companyId: company.id } });
    }
    refresh();
    return null;
  }, "Fournisseur enregistré.");
}

export type ReferentialKind = "category" | "costCenter" | "department" | "employee" | "supplier";

export async function deleteReferential(kind: ReferentialKind, id: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("referential:write");
    const where = { id, companyId: company.id };
    let count = 0;
    switch (kind) {
      case "category":
        ({ count } = await prisma.assetCategory.deleteMany({ where }));
        break;
      case "costCenter":
        ({ count } = await prisma.costCenter.deleteMany({ where }));
        break;
      case "department":
        ({ count } = await prisma.department.deleteMany({ where }));
        break;
      case "employee":
        ({ count } = await prisma.employee.deleteMany({ where }));
        break;
      case "supplier":
        ({ count } = await prisma.supplier.deleteMany({ where }));
        break;
      default:
        throw new AppError("Type de référentiel inconnu.");
    }
    if (!count) throw new AppError("Élément introuvable.", 404);
    refresh();
    return null;
  }, "Élément supprimé.");
}

export async function saveCompany(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("company:manage");
    const data = companySchema.parse(input);
    await prisma.company.update({ where: { id: company.id }, data });
    revalidatePath("/", "layout");
    return null;
  }, "Paramètres de la société enregistrés.");
}

export async function saveUser(input: unknown) {
  return runAction(async () => {
    const { user: me, companies } = await requireActionContext("user:manage");
    const data = userSchema.parse(input);
    const allowedCompanyIds = new Set(companies.map((c) => c.id));
    if (data.companyIds.some((id) => !allowedCompanyIds.has(id))) {
      throw new AppError("Vous ne pouvez rattacher que des sociétés auxquelles vous avez accès.", 403);
    }
    if (data.id === me.id && (data.role !== "ADMIN" || !data.active)) {
      throw new AppError("Vous ne pouvez pas retirer vos propres droits d'administration.");
    }
    if (!data.id && !data.password) throw new AppError("Mot de passe initial obligatoire.");

    if (data.id) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: data.id! },
          data: {
            email: data.email,
            name: data.name,
            role: data.role,
            active: data.active,
            ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
          },
        });
        // Only memberships of companies the admin manages are synchronised.
        await tx.userCompany.deleteMany({
          where: { userId: data.id!, companyId: { in: [...allowedCompanyIds], notIn: data.companyIds } },
        });
        await tx.userCompany.createMany({
          data: data.companyIds.map((companyId) => ({ userId: data.id!, companyId })),
          skipDuplicates: true,
        });
      });
    } else {
      await prisma.user.create({
        data: {
          email: data.email,
          name: data.name,
          role: data.role,
          active: data.active,
          passwordHash: await hashPassword(data.password!),
          memberships: { create: data.companyIds.map((companyId) => ({ companyId })) },
        },
      });
    }
    refresh();
    return null;
  }, "Utilisateur enregistré.");
}
