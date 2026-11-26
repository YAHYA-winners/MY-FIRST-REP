"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { clientIp, requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { recordEvents } from "@/lib/server/audit";

const printSchema = z.object({
  assetIds: z.array(z.string().min(1).max(64)).min(1).max(5000),
  templateKey: z.string().min(1).max(60),
});

/** Records a QR label print job and moves the assets' tag status to PRINTED. */
export async function markLabelsPrinted(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("label:print");
    const data = printSchema.parse(input);
    const assets = await prisma.asset.findMany({
      where: { companyId: company.id, id: { in: data.assetIds } },
      select: { id: true, code: true, tagStatus: true },
    });
    if (!assets.length) throw new AppError("Aucune immobilisation valide sélectionnée.");
    const now = new Date();
    const ip = await clientIp();
    const firstPrints = assets.filter((a) => a.tagStatus === "UNTAGGED");
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: firstPrints.map((a) => a.id) } },
        data: { tagStatus: "PRINTED", tagPrintedAt: now },
      });
      await tx.asset.updateMany({
        where: { id: { in: assets.filter((a) => a.tagStatus !== "UNTAGGED").map((a) => a.id) } },
        data: { tagPrintedAt: now },
      });
      const job = await tx.labelPrintJob.create({
        data: {
          companyId: company.id,
          templateKey: data.templateKey,
          labelCount: assets.length,
          assetIds: assets.map((a) => a.id),
          createdById: user.id,
        },
      });
      await recordEvents(
        tx,
        assets.map((a) => ({
          companyId: company.id,
          assetId: a.id,
          type: "TAG_PRINTED" as const,
          summary: a.tagStatus === "UNTAGGED" ? `Étiquette QR imprimée (${data.templateKey})` : `Réimpression de l'étiquette QR (${data.templateKey})`,
          data: { printJobId: job.id, templateKey: data.templateKey },
          userId: user.id,
          ipAddress: ip,
        })),
      );
    });
    revalidatePath("/assets/labels");
    revalidatePath("/assets");
    return { printed: assets.length, firstPrints: firstPrints.length };
  });
}

/** Manual confirmation that labels were physically affixed (without waiting for a scan). */
export async function markLabelsAffixed(input: unknown) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("label:print");
    const { assetIds } = z.object({ assetIds: z.array(z.string().min(1).max(64)).min(1).max(5000) }).parse(input);
    const assets = await prisma.asset.findMany({
      where: { companyId: company.id, id: { in: assetIds }, tagStatus: { not: "AFFIXED" } },
      select: { id: true },
    });
    const ip = await clientIp();
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: assets.map((a) => a.id) } },
        data: { tagStatus: "AFFIXED", tagAffixedAt: new Date() },
      });
      await recordEvents(
        tx,
        assets.map((a) => ({
          companyId: company.id,
          assetId: a.id,
          type: "TAG_AFFIXED" as const,
          summary: "Pose de l'étiquette confirmée manuellement",
          userId: user.id,
          ipAddress: ip,
        })),
      );
    });
    revalidatePath("/assets/labels");
    return { count: assets.length };
  }, "Pose des étiquettes confirmée.");
}
