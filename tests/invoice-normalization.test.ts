import { describe, expect, it } from "vitest";
import { checkConsistency, normalizeExtraction, normalizeIsoDate, parseLocaleNumber } from "@/lib/invoice-normalization";
import { buildInvoiceResponseSchema, buildSystemInstruction, NON_ASSET_CODE } from "@/lib/gemini-invoice-extractor";

describe("locale number & date parsing", () => {
  it("parses French / Moroccan amounts", () => {
    expect(parseLocaleNumber("12 900,00")).toBe(12900);
    expect(parseLocaleNumber("1.234,56")).toBe(1234.56);
    expect(parseLocaleNumber("1,234.56")).toBe(1234.56);
    expect(parseLocaleNumber("15 000 DH")).toBe(15000);
    expect(parseLocaleNumber("(120,50)")).toBe(-120.5);
    expect(parseLocaleNumber("n/a")).toBeNull();
    expect(parseLocaleNumber(42)).toBe(42);
  });

  it("normalises dates to ISO", () => {
    expect(normalizeIsoDate("10/11/2026")).toBe("2026-11-10");
    expect(normalizeIsoDate("2026-11-10")).toBe("2026-11-10");
    expect(normalizeIsoDate("31/02/2026")).toBeNull();
  });
});

describe("normalizeExtraction", () => {
  const raw = {
    documentType: "INVOICE",
    supplier: { name: "  MAGHREB INFO DISTRIBUTION SARL ", ice: "001 528 374 000 062", taxId: "40218753", tradeRegister: null, address: null, email: null, phone: null },
    invoice: { number: "FA-2026-0412", date: "10/11/2026", dueDate: null, currency: "DH", totalHT: "82 910,00", totalVAT: "16 582,00", totalTTC: null },
    lines: [
      { designation: "Ordinateur portable Dell Latitude 5450", specifications: "16 Go", brand: "Dell", model: "Latitude 5450", serialNumbers: ["S/N: 7HXK2W3, 9JQL4B1"], quantity: 5, unitPriceHT: "12 900,00", vatRate: 0.2, totalHT: 64500, isFixedAsset: true, assetCategoryCode: "info", classificationRationale: "Bien informatique durable", confidence: 0.95 },
      { designation: "Ramettes papier A4", specifications: null, brand: null, model: null, serialNumbers: [], quantity: 10, unitPriceHT: 240, vatRate: 20, totalHT: null, isFixedAsset: true, assetCategoryCode: NON_ASSET_CODE, classificationRationale: "Consommable", confidence: 0.99 },
      { designation: "Écran Dell 27", specifications: null, brand: "Dell", model: null, serialNumbers: [], quantity: 2, unitPriceHT: null, vatRate: null, totalHT: "4 900,00", isFixedAsset: true, assetCategoryCode: "UNKNOWN", classificationRationale: null, confidence: 80 },
    ],
    warnings: [],
    overallConfidence: 0.9,
  };
  const result = normalizeExtraction(raw, { categoryCodes: ["INFO", "MOB"], capitalizationThreshold: 3000, defaultCurrency: "MAD" });

  it("cleans the header", () => {
    expect(result.supplier.name).toBe("MAGHREB INFO DISTRIBUTION SARL");
    expect(result.supplier.ice).toBe("001528374000062");
    expect(result.invoice.date).toBe("2026-11-10");
    expect(result.invoice.currency).toBe("MAD");
    expect(result.invoice.totalTTC).toBe(99492);
  });

  it("normalises lines, serials and VAT", () => {
    const [laptop, paper, screen] = result.lines;
    expect(laptop.serialNumbers).toEqual(["7HXK2W3", "9JQL4B1"]);
    expect(laptop.vatRate).toBe(20);
    expect(laptop.categoryCode).toBe("INFO");
    expect(paper.isFixedAsset).toBe(false);
    expect(paper.totalHT).toBe(2400);
    expect(screen.unitPriceHT).toBe(2450);
    expect(screen.vatRate).toBe(20);
    expect(screen.categoryCode).toBeNull();
    expect(screen.belowThreshold).toBe(true);
    expect(screen.confidence).toBe(0.8);
    expect(screen.warnings.join(" ")).toContain("Catégorie comptable à préciser");
  });

  it("rejects payloads that are not objects", () => {
    expect(() => normalizeExtraction("nope", { categoryCodes: [] })).toThrow();
  });
});

describe("consistency checks", () => {
  it("passes on a coherent invoice", () => {
    const checks = checkConsistency({
      totalHT: 1000,
      totalVAT: 200,
      totalTTC: 1200,
      lines: [
        { quantity: 2, unitPriceHT: 250, vatRate: 20 },
        { quantity: 1, unitPriceHT: 500, vatRate: 20 },
      ],
    });
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("detects a missing line / global discount", () => {
    const checks = checkConsistency({ totalHT: 1000, totalVAT: 200, totalTTC: 1200, lines: [{ quantity: 1, unitPriceHT: 800, vatRate: 20 }] });
    const linesCheck = checks.find((c) => c.key === "lines_vs_total_ht")!;
    expect(linesCheck.ok).toBe(false);
    expect(linesCheck.delta).toBe(-200);
  });
});

describe("Gemini request shaping", () => {
  it("constrains the category to the company's codes", () => {
    const schema = buildInvoiceResponseSchema(["INFO", "mob"]);
    const lineSchema = schema.properties?.lines?.items;
    expect(lineSchema?.properties?.assetCategoryCode?.enum).toEqual(["INFO", "MOB", NON_ASSET_CODE]);
    expect(schema.required).toContain("lines");
  });

  it("injects the capitalisation threshold and categories into the system prompt", () => {
    const prompt = buildSystemInstruction({ categories: [{ code: "INFO", name: "Matériel informatique", assetAccount: "2355" }], capitalizationThreshold: 1500, defaultCurrency: "MAD" });
    expect(prompt).toContain("1500 MAD");
    expect(prompt).toContain("INFO : Matériel informatique (compte 2355)");
  });
});
