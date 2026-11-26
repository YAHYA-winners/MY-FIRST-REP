/**
 * Depreciation engine (Plan d'amortissement) — pure, framework-agnostic.
 *
 * Rules implemented (Code Général de Normalisation Comptable — Maroc, close to the
 * French PCG practice):
 *
 * LINÉAIRE
 *   - Base amortissable = valeur d'origine HT − valeur résiduelle.
 *   - Point de départ : date de mise en service (à défaut, date d'acquisition).
 *   - Prorata temporis en jours, base "année commerciale" 30/360 (30E/360).
 *
 * DÉGRESSIF
 *   - Taux dégressif = taux linéaire × coefficient
 *     (coefficients fiscaux marocains : 1,5 pour 3-4 ans ; 2 pour 5-6 ans ; 3 au-delà de 6 ans).
 *   - Point de départ : 1er jour du mois d'acquisition / mise en service (prorata en mois).
 *   - Bascule en linéaire dès que l'annuité linéaire calculée sur la durée restante
 *     devient supérieure ou égale à l'annuité dégressive.
 *
 * Sorties d'actif : la dotation de l'exercice de sortie est calculée jusqu'à la date de sortie.
 * All dates are handled in UTC (business dates are stored at UTC midnight).
 */
import type { DepreciationMethodValue } from "@/lib/domain";

export interface DepreciationInput {
  acquisitionValue: number;
  residualValue?: number | null;
  method: DepreciationMethodValue;
  usefulLifeYears: number;
  decliningCoefficient?: number | null;
  /** Date de mise en service (or acquisition date when not commissioned). */
  startDate: Date;
  /** Date de sortie (cession / mise au rebut). */
  disposalDate?: Date | null;
  /** First month of the fiscal year (1 = January). */
  fiscalYearStartMonth?: number;
}

export interface ScheduleRow {
  label: string;
  fiscalYear: number;
  periodStart: Date;
  periodEnd: Date;
  openingNetValue: number;
  rate: number; // % applied over a full year
  prorata: number; // portion of the year actually depreciated (0..1)
  annuity: number; // dotation de la période
  accumulated: number;
  closingNetValue: number;
  mode: "LINEAR" | "DECLINING";
  partial: boolean;
}

export interface DepreciationState {
  accumulated: number;
  netBookValue: number;
  currentYearAnnuity: number;
  annualRate: number;
  fullyDepreciated: boolean;
}

const EPS = 0.005;

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

export function toUtcDay(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isLastDayOfFebruary(d: Date): boolean {
  return d.getUTCMonth() === 1 && utc(d.getUTCFullYear(), 2, 0).getUTCDate() === d.getUTCDate();
}

/** Inclusive day count using the European 30E/360 convention. */
export function days360(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0;
  let d1 = start.getUTCDate();
  let d2 = end.getUTCDate();
  if (d1 === 31 || isLastDayOfFebruary(start)) d1 = 30;
  if (d2 === 31 || isLastDayOfFebruary(end)) d2 = 30;
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 360 +
    (end.getUTCMonth() - start.getUTCMonth()) * 30 +
    (d2 - d1) +
    1
  );
}

function monthsInclusive(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
}

export function fiscalYearStartFor(date: Date, startMonth = 1): Date {
  const m0 = Math.min(Math.max(startMonth, 1), 12) - 1;
  const y = date.getUTCMonth() >= m0 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return utc(y, m0, 1);
}

function fiscalYearEndFor(fyStart: Date): Date {
  return utc(fyStart.getUTCFullYear(), fyStart.getUTCMonth() + 12, 0);
}

function addYears(fyStart: Date, n: number): Date {
  return utc(fyStart.getUTCFullYear() + n, fyStart.getUTCMonth(), 1);
}

function fiscalLabel(fyStart: Date): string {
  if (fyStart.getUTCMonth() === 0) return String(fyStart.getUTCFullYear());
  return `${fyStart.getUTCFullYear()}/${fyStart.getUTCFullYear() + 1}`;
}

/** Moroccan fiscal coefficients for the declining-balance method (CGI art. 10). */
export function defaultDecliningCoefficient(usefulLifeYears: number): number {
  if (usefulLifeYears < 3) return 1;
  if (usefulLifeYears <= 4) return 1.5;
  if (usefulLifeYears <= 6) return 2;
  return 3;
}

export function annualRate(input: Pick<DepreciationInput, "method" | "usefulLifeYears" | "decliningCoefficient">): number {
  if (input.method === "NONE" || input.usefulLifeYears <= 0) return 0;
  const linear = 100 / input.usefulLifeYears;
  if (input.method === "LINEAR") return round2(linear);
  const coef = input.decliningCoefficient && input.decliningCoefficient > 0
    ? input.decliningCoefficient
    : defaultDecliningCoefficient(input.usefulLifeYears);
  return round2(linear * coef);
}

function buildLinearSchedule(input: DepreciationInput): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const value = input.acquisitionValue;
  const base = Math.max(0, value - (input.residualValue ?? 0));
  if (base <= 0) return rows;
  const n = input.usefulLifeYears;
  const annual = base / n;
  const start = toUtcDay(input.startDate);
  const disposal = input.disposalDate ? toUtcDay(input.disposalDate) : null;
  const rate = round2(100 / n);

  let fyStart = fiscalYearStartFor(start, input.fiscalYearStartMonth);
  let accumulated = 0;
  let guard = 0;
  while (base - accumulated > EPS && guard++ < 200) {
    const fyEnd = fiscalYearEndFor(fyStart);
    const periodStart = start.getTime() > fyStart.getTime() ? start : fyStart;
    if (disposal && disposal.getTime() < periodStart.getTime()) break;
    const disposedThisYear = !!disposal && disposal.getTime() <= fyEnd.getTime();
    const periodEnd = disposedThisYear ? disposal! : fyEnd;
    const prorata = Math.min(1, days360(periodStart, periodEnd) / 360);
    let annuity = round2(annual * prorata);
    const remaining = round2(base - accumulated);
    if (annuity > remaining || (!disposedThisYear && remaining - annuity < 0.05)) annuity = remaining;
    const opening = round2(value - accumulated);
    accumulated = round2(accumulated + annuity);
    rows.push({
      label: fiscalLabel(fyStart),
      fiscalYear: fyStart.getUTCFullYear(),
      periodStart,
      periodEnd,
      openingNetValue: opening,
      rate,
      prorata: round2(prorata),
      annuity,
      accumulated,
      closingNetValue: round2(value - accumulated),
      mode: "LINEAR",
      partial: prorata < 1,
    });
    if (disposedThisYear) break;
    fyStart = addYears(fyStart, 1);
  }
  return rows;
}

function buildDecliningSchedule(input: DepreciationInput): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const value = input.acquisitionValue;
  if (value <= 0) return rows;
  const n = input.usefulLifeYears;
  const coef = input.decliningCoefficient && input.decliningCoefficient > 0
    ? input.decliningCoefficient
    : defaultDecliningCoefficient(n);
  const rate = coef / n;
  const totalMonths = n * 12;
  const start = toUtcDay(input.startDate);
  const startMonth = utc(start.getUTCFullYear(), start.getUTCMonth(), 1);
  const disposal = input.disposalDate ? toUtcDay(input.disposalDate) : null;

  let fyStart = fiscalYearStartFor(startMonth, input.fiscalYearStartMonth);
  let nbv = value;
  let accumulated = 0;
  let elapsed = 0;
  let switched = false;
  let guard = 0;
  while (nbv > EPS && elapsed < totalMonths && guard++ < 200) {
    const fyEnd = fiscalYearEndFor(fyStart);
    const periodStart = startMonth.getTime() > fyStart.getTime() ? startMonth : fyStart;
    if (disposal && disposal.getTime() < periodStart.getTime()) break;
    const periodMonths = monthsInclusive(periodStart, fyEnd);
    const remainingMonths = totalMonths - elapsed;
    const effectiveMonths = Math.min(periodMonths, remainingMonths);
    const declining = nbv * rate * (effectiveMonths / 12);
    const linear = nbv * (effectiveMonths / remainingMonths);
    let mode: "LINEAR" | "DECLINING" = "DECLINING";
    let annuity: number;
    if (switched || linear >= declining) {
      switched = true;
      mode = "LINEAR";
      annuity = linear;
    } else {
      annuity = declining;
    }
    if (remainingMonths <= periodMonths) annuity = nbv; // last period: depreciate the balance
    let periodEnd = remainingMonths < periodMonths
      ? utc(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + remainingMonths, 0)
      : fyEnd;
    let partial = effectiveMonths < 12;
    const disposedThisYear = !!disposal && disposal.getTime() <= periodEnd.getTime();
    if (disposedThisYear) {
      const ratio = days360(periodStart, disposal!) / days360(periodStart, periodEnd);
      annuity = annuity * Math.min(1, ratio);
      periodEnd = disposal!;
      partial = true;
    }
    annuity = Math.min(round2(annuity), round2(nbv));
    const opening = round2(nbv);
    accumulated = round2(accumulated + annuity);
    nbv = round2(value - accumulated);
    rows.push({
      label: fiscalLabel(fyStart),
      fiscalYear: fyStart.getUTCFullYear(),
      periodStart,
      periodEnd,
      openingNetValue: opening,
      rate: round2((mode === "DECLINING" ? rate : 1 / (remainingMonths / 12)) * 100),
      prorata: round2(effectiveMonths / 12),
      annuity,
      accumulated,
      closingNetValue: nbv,
      mode,
      partial,
    });
    if (disposedThisYear) break;
    elapsed += effectiveMonths;
    fyStart = addYears(fyStart, 1);
  }
  return rows;
}

/** Full depreciation schedule (plan d'amortissement). */
export function buildSchedule(input: DepreciationInput): ScheduleRow[] {
  if (input.method === "NONE" || input.usefulLifeYears <= 0 || input.acquisitionValue <= 0) return [];
  return input.method === "DECLINING" ? buildDecliningSchedule(input) : buildLinearSchedule(input);
}

/** Accumulated depreciation and net book value (VNC) at a given date. */
export function computeDepreciation(input: DepreciationInput, asOf: Date = new Date()): DepreciationState {
  const value = input.acquisitionValue;
  const rate = annualRate(input);
  const schedule = buildSchedule(input);
  if (schedule.length === 0) {
    return { accumulated: 0, netBookValue: round2(value), currentYearAnnuity: 0, annualRate: rate, fullyDepreciated: false };
  }
  const asOfDay = toUtcDay(asOf);
  const disposal = input.disposalDate ? toUtcDay(input.disposalDate) : null;
  const limit = disposal && disposal.getTime() < asOfDay.getTime() ? disposal : asOfDay;
  const currentFyStart = fiscalYearStartFor(limit, input.fiscalYearStartMonth).getTime();

  let accumulated = 0;
  let currentYearAnnuity = 0;
  for (const row of schedule) {
    if (row.periodStart.getTime() > limit.getTime()) break;
    const fyOfRow = fiscalYearStartFor(row.periodStart, input.fiscalYearStartMonth).getTime();
    if (row.periodEnd.getTime() <= limit.getTime()) {
      accumulated += row.annuity;
      if (fyOfRow === currentFyStart) currentYearAnnuity += row.annuity;
    } else {
      const ratio = days360(row.periodStart, limit) / days360(row.periodStart, row.periodEnd);
      const portion = round2(row.annuity * Math.min(1, Math.max(0, ratio)));
      accumulated += portion;
      if (fyOfRow === currentFyStart) currentYearAnnuity += portion;
      break;
    }
  }
  accumulated = round2(Math.min(accumulated, value));
  const last = schedule[schedule.length - 1];
  return {
    accumulated,
    netBookValue: round2(value - accumulated),
    currentYearAnnuity: round2(currentYearAnnuity),
    annualRate: rate,
    fullyDepreciated: accumulated >= round2(last.accumulated) - EPS && last.closingNetValue <= round2(input.residualValue ?? 0) + EPS,
  };
}

/** Convenience adapter for Prisma rows (Decimal-compatible via Number()). */
export interface AssetFinanceFields {
  acquisitionValue: unknown;
  residualValue?: unknown;
  depreciationMethod: DepreciationMethodValue;
  usefulLifeYears: number;
  decliningCoefficient?: unknown;
  acquisitionDate: Date;
  commissioningDate?: Date | null;
  disposalDate?: Date | null;
}

export function toDepreciationInput(asset: AssetFinanceFields, fiscalYearStartMonth = 1): DepreciationInput {
  const coef = asset.decliningCoefficient === null || asset.decliningCoefficient === undefined
    ? null
    : Number(asset.decliningCoefficient);
  return {
    acquisitionValue: Number(asset.acquisitionValue) || 0,
    residualValue: asset.residualValue === null || asset.residualValue === undefined ? 0 : Number(asset.residualValue),
    method: asset.depreciationMethod,
    usefulLifeYears: asset.usefulLifeYears,
    decliningCoefficient: coef,
    startDate: asset.commissioningDate ?? asset.acquisitionDate,
    disposalDate: asset.disposalDate ?? null,
    fiscalYearStartMonth,
  };
}

export function assetDepreciation(asset: AssetFinanceFields, asOf: Date = new Date(), fiscalYearStartMonth = 1): DepreciationState {
  return computeDepreciation(toDepreciationInput(asset, fiscalYearStartMonth), asOf);
}
