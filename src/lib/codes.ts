/**
 * Asset / location code formatting and QR payload parsing — pure & client-safe.
 */
export const ASSET_CODE_PREFIX = "IMM";
export const TEMP_TAG_PREFIX = "TMP";
export const LOCATION_QR_PREFIX = "LOC:";

const CODE_RE = /^[A-Z]{2,5}-\d{4}-\d{3,6}$/;

export function formatAssetCode(year: number, sequence: number, prefix = ASSET_CODE_PREFIX): string {
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

export function formatCampaignCode(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(3, "0")}`;
}

export function formatTempTag(year: number, sequence: number): string {
  return `${TEMP_TAG_PREFIX}-${year}-${String(sequence).padStart(5, "0")}`;
}

export function isAssetCode(value: string): boolean {
  return CODE_RE.test(value.trim().toUpperCase());
}

/** Payload encoded in an asset QR label: a deep link that also works with any phone camera. */
export function assetQrPayload(code: string, appUrl?: string | null): string {
  const base = (appUrl ?? "").replace(/\/+$/, "");
  return base ? `${base}/a/${encodeURIComponent(code)}` : code;
}

export function locationQrPayload(locationCode: string): string {
  return `${LOCATION_QR_PREFIX}${locationCode}`;
}

export type ParsedScan =
  | { kind: "asset"; code: string; raw: string }
  | { kind: "location"; code: string; raw: string }
  | { kind: "raw"; value: string; raw: string };

/**
 * Normalises what the camera / hand-held scanner read:
 *  - "LOC:SCA-E2-B204"                      → location
 *  - "https://app.example.com/a/IMM-2026-00042" → asset IMM-2026-00042
 *  - "imm-2026-00042"                        → asset IMM-2026-00042
 *  - anything else (serial number, legacy barcode) → raw
 */
export function parseScannedCode(input: string): ParsedScan {
  const raw = input.trim();
  if (!raw) return { kind: "raw", value: "", raw };
  if (raw.toUpperCase().startsWith(LOCATION_QR_PREFIX)) {
    return { kind: "location", code: raw.slice(LOCATION_QR_PREFIX.length).trim(), raw };
  }
  const urlMatch = raw.match(/\/a\/([^/?#\s]+)/i);
  if (urlMatch) {
    let code = urlMatch[1];
    try {
      code = decodeURIComponent(code);
    } catch {
      /* keep raw segment */
    }
    return { kind: "asset", code: code.toUpperCase(), raw };
  }
  const upper = raw.toUpperCase();
  if (CODE_RE.test(upper)) return { kind: "asset", code: upper, raw };
  return { kind: "raw", value: raw, raw };
}
