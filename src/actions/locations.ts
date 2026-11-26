"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { locationSchema } from "@/lib/validators";
import { requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { assertCompanyRefs } from "@/lib/server/guards";
import { rebuildLocationPaths } from "@/lib/server/locations";

export async function saveLocation(input: unknown) {
  return runAction(async () => {
    const { company } = await requireActionContext("location:write");
    const data = locationSchema.parse(input);
    await assertCompanyRefs(company.id, { locationId: data.parentId, departmentId: data.departmentId });

    if (data.id) {
      const current = await prisma.location.findFirst({ where: { id: data.id, companyId: company.id } });
      if (!current) throw new AppError("Localisation introuvable.", 404);
      if (data.parentId) {
        if (data.parentId === data.id) throw new AppError("Une localisation ne peut pas être son propre parent.");
        const parent = await prisma.location.findUniqueOrThrow({ where: { id: data.parentId }, select: { pathIds: true } });
        if (parent.pathIds.includes(`/${data.id}/`)) {
          throw new AppError("Déplacement impossible : le parent choisi est un sous-niveau de cette localisation.");
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.location.update({
          where: { id: data.id! },
          data: {
            parentId: data.parentId,
            type: data.type,
            code: data.code,
            name: data.name,
            departmentId: data.departmentId,
            address: data.address,
            active: data.active,
          },
        });
        if (current.name !== data.name || current.parentId !== data.parentId) {
          await rebuildLocationPaths(tx, company.id);
        }
      });
      revalidatePath("/locations");
      return { id: data.id };
    }

    const parent = data.parentId
      ? await prisma.location.findUniqueOrThrow({ where: { id: data.parentId }, select: { path: true, pathIds: true, depth: true } })
      : null;
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.location.create({
        data: {
          companyId: company.id,
          parentId: data.parentId,
          type: data.type,
          code: data.code,
          name: data.name,
          departmentId: data.departmentId,
          address: data.address,
          active: data.active,
          path: parent ? `${parent.path} > ${data.name}` : data.name,
          pathIds: "",
          depth: parent ? parent.depth + 1 : 0,
        },
      });
      return tx.location.update({
        where: { id: row.id },
        data: { pathIds: `${parent?.pathIds ?? "/"}${row.id}/` },
      });
    });
    revalidatePath("/locations");
    return { id: created.id };
  }, "Localisation enregistrée.");
}

export async function deleteLocation(locationId: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("location:write");
    const location = await prisma.location.findFirst({
      where: { id: locationId, companyId: company.id },
      include: { _count: { select: { children: true, assets: true, scans: true, campaignScopes: true } } },
    });
    if (!location) throw new AppError("Localisation introuvable.", 404);
    if (location._count.children) throw new AppError("Supprimez d'abord les sous-niveaux de cette localisation.");
    if (location._count.assets) throw new AppError(`${location._count.assets} bien(s) sont rattachés à cette localisation : transférez-les avant suppression.`);
    if (location._count.scans || location._count.campaignScopes) {
      throw new AppError("Localisation utilisée dans une campagne d'inventaire : désactivez-la plutôt que de la supprimer.");
    }
    await prisma.location.delete({ where: { id: location.id } });
    revalidatePath("/locations");
    return null;
  }, "Localisation supprimée.");
}
