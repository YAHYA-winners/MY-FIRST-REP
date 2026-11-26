import { NextResponse } from "next/server";
import { requireActionContext } from "@/lib/server/auth";
import { handleApiError, jsonError } from "@/lib/server/api";
import { companyIdFromKey, contentTypeForKey, getObject } from "@/lib/server/storage";

export const runtime = "nodejs";

/** Serves stored files (invoices, photos, signatures) to members of the owning company only. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const { companies } = await requireActionContext();
    const { key: segments } = await params;
    const key = segments.map((s) => decodeURIComponent(s)).join("/");
    const owner = companyIdFromKey(key);
    if (!companies.some((c) => c.id === owner)) return jsonError("Accès refusé.", 403);
    const data = await getObject(key);
    const fileName = key.split("/").pop() ?? "fichier";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeForKey(key),
        "Content-Length": String(data.length),
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
