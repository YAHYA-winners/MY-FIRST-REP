import "server-only";
import { prisma } from "@/lib/prisma";

export interface ProgressDatum {
  name: string;
  expected: number;
  found: number;
  remaining: number;
}

/** Counting progress of a campaign grouped by site and by floor (from the frozen snapshot). */
export async function computeCampaignProgress(companyId: string, campaignId: string) {
  const [snapshot, scanned, locations] = await Promise.all([
    prisma.campaignSnapshotItem.findMany({ where: { campaignId }, select: { assetId: true, expectedLocationId: true } }),
    prisma.campaignScan.findMany({ where: { campaignId }, select: { assetId: true }, distinct: ["assetId"] }),
    prisma.location.findMany({ where: { companyId }, select: { id: true, name: true, type: true, pathIds: true } }),
  ]);
  const scannedSet = new Set(scanned.map((s) => s.assetId));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const site = new Map<string, ProgressDatum>();
  const floor = new Map<string, ProgressDatum>();
  const bump = (map: Map<string, ProgressDatum>, name: string, isFound: boolean) => {
    const d = map.get(name) ?? { name, expected: 0, found: 0, remaining: 0 };
    d.expected += 1;
    if (isFound) d.found += 1;
    else d.remaining += 1;
    map.set(name, d);
  };
  let found = 0;
  for (const item of snapshot) {
    const isFound = scannedSet.has(item.assetId);
    if (isFound) found += 1;
    const loc = item.expectedLocationId ? locById.get(item.expectedLocationId) : undefined;
    if (!loc) {
      bump(site, "Sans localisation", isFound);
      bump(floor, "Sans localisation", isFound);
      continue;
    }
    const ancestors = loc.pathIds
      .split("/")
      .filter(Boolean)
      .map((id) => locById.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l);
    const root = ancestors[0];
    bump(site, root?.name ?? loc.name, isFound);
    const floorNode = ancestors.find((a) => a.type === "FLOOR") ?? ancestors.find((a) => a.type === "BUILDING") ?? root;
    const label = floorNode && root && floorNode.id !== root.id ? `${root.name} · ${floorNode.name}` : floorNode?.name ?? loc.name;
    bump(floor, label, isFound);
  }
  return {
    expected: snapshot.length,
    found,
    scannedAssetIds: scannedSet,
    bySite: [...site.values()].sort((a, b) => b.expected - a.expected),
    byFloor: [...floor.values()].sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true })),
  };
}
