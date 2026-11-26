import { describe, expect, it } from "vitest";
import { annualRate, buildSchedule, computeDepreciation, days360, defaultDecliningCoefficient } from "@/lib/depreciation";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("days360 (30E/360, inclusive)", () => {
  it("counts a full calendar year as 360 days", () => {
    expect(days360(d("2026-01-01"), d("2026-12-31"))).toBe(360);
  });
  it("counts half a year as 180 days", () => {
    expect(days360(d("2026-07-01"), d("2026-12-31"))).toBe(180);
    expect(days360(d("2026-01-01"), d("2026-06-30"))).toBe(180);
  });
  it("treats the end of February as day 30", () => {
    expect(days360(d("2026-01-01"), d("2026-02-28"))).toBe(60);
  });
});

describe("linear depreciation", () => {
  const input = { acquisitionValue: 12000, method: "LINEAR" as const, usefulLifeYears: 5, startDate: d("2024-07-01") };

  it("applies prorata temporis on the first and last fiscal years", () => {
    const rows = buildSchedule(input);
    expect(rows.map((r) => r.annuity)).toEqual([1200, 2400, 2400, 2400, 2400, 1200]);
    expect(rows.at(-1)?.closingNetValue).toBe(0);
    expect(rows[0].prorata).toBe(0.5);
  });

  it("computes accumulated depreciation and VNC at an arbitrary date", () => {
    const state = computeDepreciation(input, d("2026-06-30"));
    expect(state.accumulated).toBe(4800);
    expect(state.netBookValue).toBe(7200);
    expect(state.currentYearAnnuity).toBe(1200);
    expect(state.annualRate).toBe(20);
  });

  it("has no prorata when commissioned on the first day of the fiscal year", () => {
    const rows = buildSchedule({ acquisitionValue: 10000, method: "LINEAR", usefulLifeYears: 4, startDate: d("2023-01-01") });
    expect(rows.map((r) => r.annuity)).toEqual([2500, 2500, 2500, 2500]);
  });

  it("respects the residual value", () => {
    const rows = buildSchedule({ acquisitionValue: 10000, residualValue: 2000, method: "LINEAR", usefulLifeYears: 4, startDate: d("2023-01-01") });
    expect(rows.reduce((a, r) => a + r.annuity, 0)).toBe(8000);
    expect(rows.at(-1)?.closingNetValue).toBe(2000);
  });

  it("stops at the disposal date", () => {
    const state = computeDepreciation({ ...input, startDate: d("2024-01-01"), disposalDate: d("2025-06-30") }, d("2026-12-31"));
    expect(state.accumulated).toBe(3600);
    expect(state.netBookValue).toBe(8400);
  });

  it("is fully depreciated after its useful life", () => {
    const state = computeDepreciation(input, d("2031-01-01"));
    expect(state.netBookValue).toBe(0);
    expect(state.fullyDepreciated).toBe(true);
  });

  it("supports a fiscal year not aligned on the calendar year", () => {
    const rows = buildSchedule({ acquisitionValue: 12000, method: "LINEAR", usefulLifeYears: 2, startDate: d("2025-07-01"), fiscalYearStartMonth: 7 });
    expect(rows.map((r) => r.annuity)).toEqual([6000, 6000]);
    expect(rows[0].label).toBe("2025/2026");
  });
});

describe("declining-balance depreciation (dégressif)", () => {
  it("uses the Moroccan fiscal coefficients", () => {
    expect(defaultDecliningCoefficient(2)).toBe(1);
    expect(defaultDecliningCoefficient(4)).toBe(1.5);
    expect(defaultDecliningCoefficient(5)).toBe(2);
    expect(defaultDecliningCoefficient(10)).toBe(3);
    expect(annualRate({ method: "DECLINING", usefulLifeYears: 5 })).toBe(40);
  });

  it("starts on the first day of the acquisition month and switches to linear", () => {
    const rows = buildSchedule({ acquisitionValue: 100000, method: "DECLINING", usefulLifeYears: 5, startDate: d("2024-04-15") });
    expect(rows.map((r) => r.annuity)).toEqual([30000, 28000, 16800, 11200, 11200, 2800]);
    expect(rows.map((r) => r.mode)).toEqual(["DECLINING", "DECLINING", "DECLINING", "LINEAR", "LINEAR", "LINEAR"]);
    expect(rows.reduce((a, r) => a + r.annuity, 0)).toBe(100000);
    expect(rows.at(-1)?.periodEnd.toISOString().slice(0, 10)).toBe("2029-03-31");
  });
});

describe("non-depreciable assets", () => {
  it("keeps the gross value as VNC", () => {
    const state = computeDepreciation({ acquisitionValue: 500000, method: "NONE", usefulLifeYears: 0, startDate: d("2020-01-01") }, d("2026-11-26"));
    expect(state.netBookValue).toBe(500000);
    expect(state.accumulated).toBe(0);
  });
});
