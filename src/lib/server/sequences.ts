import "server-only";
import type { Tx } from "@/lib/prisma";
import { formatAssetCode, formatCampaignCode, formatTempTag } from "@/lib/codes";

/**
 * Atomically reserves `count` consecutive numbers of a per-company counter.
 * INSERT … ON CONFLICT DO UPDATE takes a row lock, so concurrent requests can
 * never obtain the same number (codes are gap-free inside a committed tx).
 */
export async function reserveSequence(tx: Tx, companyId: string, key: string, count = 1): Promise<number[]> {
  if (count <= 0) return [];
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("companyId", "key", "value")
    VALUES (${companyId}, ${key}, ${count}::int)
    ON CONFLICT ("companyId", "key")
    DO UPDATE SET "value" = "Sequence"."value" + ${count}::int
    RETURNING "value"`;
  const last = Number(rows[0]?.value ?? count);
  return Array.from({ length: count }, (_, i) => last - count + 1 + i);
}

export async function nextAssetCodes(tx: Tx, companyId: string, count: number, year = new Date().getUTCFullYear()) {
  const numbers = await reserveSequence(tx, companyId, `ASSET-${year}`, count);
  return numbers.map((n) => formatAssetCode(year, n));
}

export async function nextCampaignCode(tx: Tx, companyId: string, year = new Date().getUTCFullYear()) {
  const [n] = await reserveSequence(tx, companyId, `CAMPAIGN-${year}`, 1);
  return formatCampaignCode(year, n);
}

export async function nextTempTag(tx: Tx, companyId: string, year = new Date().getUTCFullYear()) {
  const [n] = await reserveSequence(tx, companyId, `TMP-${year}`, 1);
  return formatTempTag(year, n);
}

export async function nextPvNumber(tx: Tx, companyId: string, year = new Date().getUTCFullYear()) {
  const [n] = await reserveSequence(tx, companyId, `PV-${year}`, 1);
  return `PV-INV-${year}-${String(n).padStart(3, "0")}`;
}
