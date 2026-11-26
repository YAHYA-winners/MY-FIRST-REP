/**
 * File storage (invoices, field photos, e-signatures).
 * Local-disk driver with strict key validation; keys are prefixed by companyId so
 * that access can be authorised per entity. Swap `putObject` / `getObject` for an
 * S3-compatible driver in multi-instance deployments.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/errors";

const ROOT = path.resolve(process.env.STORAGE_DIR || "./storage");
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,255}$/;

export type StorageFolder = "invoices" | "photos" | "signatures" | "surplus";

export const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const EXTENSION_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, ext]) => [ext, mime]),
);

export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new AppError("Clé de fichier invalide.", 400);
  }
}

function resolveKey(key: string): string {
  assertSafeKey(key);
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new AppError("Clé de fichier invalide.", 400);
  return full;
}

export function buildStorageKey(companyId: string, folder: StorageFolder, extension: string): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${companyId}/${folder}/${now.getUTCFullYear()}/${month}/${randomUUID()}.${extension}`;
}

export function companyIdFromKey(key: string): string {
  return key.split("/")[0] ?? "";
}

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data, { flag: "wx" });
}

export async function getObject(key: string): Promise<Buffer> {
  const full = resolveKey(key);
  try {
    return await fs.readFile(full);
  } catch {
    throw new AppError("Fichier introuvable.", 404);
  }
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Detects the real file type from its magic bytes (never trust the browser's
 * Content-Type). Returns null for unsupported formats.
 */
export function sniffMimeType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
  }
  return null;
}

export async function readUploadedFile(file: File, maxBytes: number, allowed: string[]) {
  if (file.size === 0) throw new AppError(`Le fichier « ${file.name} » est vide.`, 400);
  if (file.size > maxBytes) {
    throw new AppError(`Le fichier « ${file.name} » dépasse la taille maximale (${Math.round(maxBytes / 1024 / 1024)} Mo).`, 413);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffMimeType(buffer);
  if (!mimeType || !allowed.includes(mimeType)) {
    throw new AppError(`Format non supporté pour « ${file.name} ». Formats acceptés : ${allowed.map((m) => MIME_EXTENSIONS[m]?.toUpperCase()).join(", ")}.`, 415);
  }
  return { buffer, mimeType, extension: MIME_EXTENSIONS[mimeType] };
}
