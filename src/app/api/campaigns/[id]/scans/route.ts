import { NextResponse } from "next/server";
import { clientIp, requireActionContext } from "@/lib/server/auth";
import { handleApiError } from "@/lib/server/api";
import { recordScan } from "@/lib/server/field-service";

export const runtime = "nodejs";

/** Idempotent scan ingestion (the device generates `clientId`, so offline retries never double count). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireActionContext("campaign:scan");
    const { id } = await params;
    const body = await req.json();
    const result = await recordScan(ctx, id, body, await clientIp());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
