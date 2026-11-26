import { NextResponse } from "next/server";
import { clientIp, requireActionContext } from "@/lib/server/auth";
import { handleApiError } from "@/lib/server/api";
import { recordSurplus } from "@/lib/server/field-service";

export const runtime = "nodejs";

/** Surplus / unlabelled asset capture (Biens non étiquetés / Excédents). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireActionContext("campaign:scan");
    const { id } = await params;
    const body = await req.json();
    const result = await recordSurplus(ctx, id, body, await clientIp());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
