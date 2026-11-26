import "server-only";
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";

export type AssetEventInput = Omit<Prisma.AssetEventCreateManyInput, "id" | "createdAt">;

/** Appends events to the immutable audit trail (AssetEvent is append-only at DB level). */
export async function recordEvents(tx: Tx, events: AssetEventInput[]): Promise<void> {
  if (events.length === 0) return;
  for (let i = 0; i < events.length; i += 1000) {
    await tx.assetEvent.createMany({ data: events.slice(i, i + 1000) });
  }
}
