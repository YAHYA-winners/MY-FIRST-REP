import { NextResponse } from "next/server";
import { requireActionContext } from "@/lib/server/auth";
import { handleApiError, jsonError } from "@/lib/server/api";
import { buildStorageKey, putObject, readUploadedFile } from "@/lib/server/storage";

export const runtime = "nodejs";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** Field photos (damaged assets, surplus items). Returns the storage key to attach to a scan. */
export async function POST(req: Request) {
  try {
    const { company } = await requireActionContext("campaign:scan");
    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "photos");
    if (!(file instanceof File)) return jsonError("Aucun fichier reçu.", 400);
    const folder = kind === "surplus" ? "surplus" : "photos";
    const { buffer, extension } = await readUploadedFile(file, 10 * 1024 * 1024, IMAGE_TYPES);
    const key = buildStorageKey(company.id, folder, extension);
    await putObject(key, buffer);
    return NextResponse.json({ key }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
