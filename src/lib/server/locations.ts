import "server-only";
import type { Tx } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";

interface LocationRow {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  pathIds: string;
  depth: number;
}

/** Recomputes materialized paths (names, ids, depth) for every location of a company. */
export async function rebuildLocationPaths(tx: Tx, companyId: string): Promise<void> {
  const rows: LocationRow[] = await tx.location.findMany({
    where: { companyId },
    select: { id: true, parentId: true, name: true, path: true, pathIds: true, depth: true },
  });
  const byParent = new Map<string | null, LocationRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const updates: { id: string; path: string; pathIds: string; depth: number }[] = [];
  const walk = (parent: { path: string; pathIds: string; depth: number } | null, parentId: string | null) => {
    for (const child of byParent.get(parentId) ?? []) {
      const path = parent ? `${parent.path} > ${child.name}` : child.name;
      const pathIds = parent ? `${parent.pathIds}${child.id}/` : `/${child.id}/`;
      const depth = parent ? parent.depth + 1 : 0;
      if (child.path !== path || child.pathIds !== pathIds || child.depth !== depth) {
        updates.push({ id: child.id, path, pathIds, depth });
      }
      walk({ path, pathIds, depth }, child.id);
    }
  };
  walk(null, null);
  for (const u of updates) {
    await tx.location.update({ where: { id: u.id }, data: { path: u.path, pathIds: u.pathIds, depth: u.depth } });
  }
}

/** Location ids of the given nodes and all their descendants. */
export async function expandLocationSubtrees(companyId: string, locationIds: string[]): Promise<string[]> {
  if (locationIds.length === 0) return [];
  const roots = await prisma.location.findMany({
    where: { companyId, id: { in: locationIds } },
    select: { pathIds: true },
  });
  if (roots.length === 0) return [];
  const all = await prisma.location.findMany({
    where: { companyId, OR: roots.map((r) => ({ pathIds: { startsWith: r.pathIds } })) },
    select: { id: true },
  });
  return all.map((l) => l.id);
}

export async function locationPathMap(companyId: string): Promise<Map<string, string>> {
  const rows = await prisma.location.findMany({ where: { companyId }, select: { id: true, path: true } });
  return new Map(rows.map((r) => [r.id, r.path]));
}
