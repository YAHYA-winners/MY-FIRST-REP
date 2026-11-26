"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { round2 } from "@/lib/utils";
import { invoiceApprovalSchema, type InvoiceApprovalInput } from "@/lib/validators";
import { clientIp, requireActionContext } from "@/lib/server/auth";
import { runAction } from "@/lib/server/action-result";
import { assertCompanyRefs } from "@/lib/server/guards";
import { nextAssetCodes } from "@/lib/server/sequences";
import { recordEvents } from "@/lib/server/audit";

/**
 * Validates an (AI-extracted, human-reviewed) supplier invoice and generates the
 * corresponding asset cards. A line of N identical goods can be split into N
 * individual assets (one per unit, each with its own serial number and code) or
 * kept as a single lot.
 */
export async function approveInvoice(input: InvoiceApprovalInput) {
  return runAction(async () => {
    const { user, company } = await requireActionContext("invoice:validate");
    const data = invoiceApprovalSchema.parse(input);

    const invoice = await prisma.invoice.findFirst({ where: { id: data.invoiceId, companyId: company.id } });
    if (!invoice) throw new AppError("Facture introuvable.", 404);
    if (invoice.status === "VALIDATED") throw new AppError("Cette facture est déjà validée.");
    if (invoice.status === "EXTRACTING") throw new AppError("Extraction en cours : patientez avant de valider.");

    await assertCompanyRefs(company.id, {
      categoryIds: data.lines.map((l) => l.categoryId).filter((v): v is string => !!v),
      locationId: data.defaultLocationId,
      costCenterId: data.defaultCostCenterId,
      departmentId: data.defaultDepartmentId,
    });

    // Supplier resolution: ICE first (unique fiscal id), then case-insensitive name.
    const existingSupplier = data.supplier.ice
      ? await prisma.supplier.findFirst({ where: { companyId: company.id, ice: data.supplier.ice } })
      : await prisma.supplier.findFirst({
          where: { companyId: company.id, name: { equals: data.supplier.name, mode: "insensitive" } },
        });

    if (!data.allowDuplicate) {
      if (existingSupplier) {
        const duplicate = await prisma.invoice.findFirst({
          where: {
            companyId: company.id,
            supplierId: existingSupplier.id,
            number: { equals: data.number, mode: "insensitive" },
            status: "VALIDATED",
            id: { not: invoice.id },
          },
        });
        if (duplicate) {
          throw new AppError(`DUPLICATE: la facture ${data.number} de ${existingSupplier.name} a déjà été validée. Cochez « Autoriser le doublon » pour forcer.`, 409);
        }
      }
      const serials = data.lines.filter((l) => l.isFixedAsset).flatMap((l) => l.serialNumbers);
      if (serials.length) {
        const known = await prisma.asset.findMany({
          where: { companyId: company.id, serialNumber: { in: serials } },
          select: { code: true, serialNumber: true },
          take: 10,
        });
        if (known.length) {
          throw new AppError(
            `DUPLICATE: numéro(s) de série déjà présents dans le registre : ${known.map((k) => `${k.serialNumber} (${k.code})`).join(", ")}.`,
            409,
          );
        }
      }
    }

    const categories = await prisma.assetCategory.findMany({ where: { companyId: company.id } });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const commissioningDate = data.commissioningDate ?? (data.initialStatus === "IN_SERVICE" ? data.invoiceDate : null);
    const ip = await clientIp();

    const result = await prisma.$transaction(
      async (tx) => {
        const supplier = existingSupplier
          ? await tx.supplier.update({
              where: { id: existingSupplier.id },
              data: {
                ice: existingSupplier.ice ?? data.supplier.ice,
                taxId: existingSupplier.taxId ?? data.supplier.taxId,
                tradeRegister: existingSupplier.tradeRegister ?? data.supplier.tradeRegister,
                address: existingSupplier.address ?? data.supplier.address,
              },
            })
          : await tx.supplier.create({
              data: {
                companyId: company.id,
                name: data.supplier.name,
                ice: data.supplier.ice,
                taxId: data.supplier.taxId,
                tradeRegister: data.supplier.tradeRegister,
                address: data.supplier.address,
              },
            });

        await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
        const lines = await tx.invoiceLine.createManyAndReturn({
          data: data.lines.map((line, index) => ({
            invoiceId: invoice.id,
            lineNo: index + 1,
            designation: line.designation,
            specifications: line.specifications,
            brand: line.brand,
            model: line.model,
            serialNumbers: line.serialNumbers,
            quantity: line.quantity,
            unitPriceHT: line.unitPriceHT,
            vatRate: line.vatRate,
            totalHT: round2(line.quantity * line.unitPriceHT),
            isFixedAsset: line.isFixedAsset,
            splitIntoUnits: line.splitIntoUnits,
            categoryId: line.isFixedAsset ? line.categoryId : null,
            aiCategoryCode: line.aiCategoryCode,
            aiConfidence: line.aiConfidence ?? null,
          })),
          select: { id: true, lineNo: true },
        });
        const lineIdByNo = new Map(lines.map((l) => [l.lineNo, l.id]));

        // Build one asset per unit (split) or one per lot.
        const drafts: Omit<Prisma.AssetCreateManyInput, "code">[] = [];
        data.lines.forEach((line, index) => {
          if (!line.isFixedAsset || !line.categoryId) return;
          const category = categoryById.get(line.categoryId)!;
          const base = {
            companyId: company.id,
            designation: line.designation,
            description: line.specifications,
            brand: line.brand,
            model: line.model,
            categoryId: category.id,
            supplierId: supplier.id,
            invoiceId: invoice.id,
            invoiceLineId: lineIdByNo.get(index + 1)!,
            acquisitionDate: data.invoiceDate,
            commissioningDate,
            vatRate: line.vatRate,
            currency: data.currency,
            depreciationMethod: category.defaultMethod,
            usefulLifeYears: category.defaultUsefulLifeYears,
            decliningCoefficient: category.defaultMethod === "DECLINING" ? category.decliningCoefficient : null,
            status: data.initialStatus,
            origin: "INVOICE" as const,
            locationId: data.defaultLocationId,
            costCenterId: data.defaultCostCenterId,
            departmentId: data.defaultDepartmentId,
            createdById: user.id,
          };
          const units = Number.isInteger(line.quantity) ? line.quantity : 1;
          if (line.splitIntoUnits && units > 1) {
            for (let u = 0; u < units; u++) {
              drafts.push({ ...base, quantity: 1, acquisitionValue: line.unitPriceHT, serialNumber: line.serialNumbers[u] ?? null });
            }
          } else {
            const serialNote = line.serialNumbers.length > 1 ? `N° de série : ${line.serialNumbers.join(", ")}` : null;
            drafts.push({
              ...base,
              quantity: units,
              acquisitionValue: round2(line.quantity * line.unitPriceHT),
              serialNumber: line.serialNumbers.length === 1 ? line.serialNumbers[0] : null,
              description: [line.specifications, serialNote].filter(Boolean).join("\n") || null,
            });
          }
        });

        const codes = await nextAssetCodes(tx, company.id, drafts.length);
        const assets = drafts.length
          ? await tx.asset.createManyAndReturn({
              data: drafts.map((d, i) => ({ ...d, code: codes[i] })),
              select: { id: true, code: true, locationId: true, status: true, invoiceLineId: true },
            })
          : [];

        await recordEvents(
          tx,
          assets.map((a) => ({
            companyId: company.id,
            assetId: a.id,
            type: "CREATED" as const,
            summary: `Création depuis la facture ${data.number} (${supplier.name})`,
            toLocationId: a.locationId,
            toStatus: a.status,
            data: { invoiceId: invoice.id, invoiceNumber: data.number, invoiceLineId: a.invoiceLineId },
            userId: user.id,
            ipAddress: ip,
          })),
        );

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            supplierId: supplier.id,
            number: data.number,
            invoiceDate: data.invoiceDate,
            currency: data.currency,
            totalHT: data.totalHT,
            totalVAT: data.totalVAT,
            totalTTC: data.totalTTC,
            status: "VALIDATED",
            validatedById: user.id,
            validatedAt: new Date(),
          },
        });
        return { assetCount: assets.length, firstCode: assets[0]?.code ?? null, lastCode: assets.at(-1)?.code ?? null };
      },
      { timeout: 60_000 },
    );

    revalidatePath("/invoices");
    revalidatePath("/invoices/import");
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    return result;
  });
}

export async function rejectInvoice(invoiceId: string, reason: string) {
  return runAction(async () => {
    const { company } = await requireActionContext("invoice:validate");
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < 3) throw new AppError("Indiquez le motif du rejet.");
    const { count } = await prisma.invoice.updateMany({
      where: { id: invoiceId, companyId: company.id, status: { not: "VALIDATED" } },
      data: { status: "REJECTED", rejectionReason: trimmed.slice(0, 500) },
    });
    if (!count) throw new AppError("Facture introuvable ou déjà validée.");
    revalidatePath("/invoices");
    revalidatePath("/invoices/import");
    return null;
  }, "Document rejeté.");
}
