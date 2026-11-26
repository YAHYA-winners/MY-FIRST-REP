import { describe, expect, it } from "vitest";
import { assetQrPayload, formatAssetCode, formatTempTag, parseScannedCode } from "@/lib/codes";

describe("asset codes & QR payloads", () => {
  it("formats codes", () => {
    expect(formatAssetCode(2026, 42)).toBe("IMM-2026-00042");
    expect(formatTempTag(2026, 7)).toBe("TMP-2026-00007");
  });

  it("encodes a deep link usable by any phone camera", () => {
    expect(assetQrPayload("IMM-2026-00042", "https://immo.example.ma/")).toBe("https://immo.example.ma/a/IMM-2026-00042");
    expect(assetQrPayload("IMM-2026-00042", "")).toBe("IMM-2026-00042");
  });

  it("parses deep links, raw codes, room QR codes and legacy barcodes", () => {
    expect(parseScannedCode("https://immo.example.ma/a/IMM-2026-00042")).toMatchObject({ kind: "asset", code: "IMM-2026-00042" });
    expect(parseScannedCode("  imm-2026-00042 ")).toMatchObject({ kind: "asset", code: "IMM-2026-00042" });
    expect(parseScannedCode("LOC:CAS-E2-B204")).toMatchObject({ kind: "location", code: "CAS-E2-B204" });
    expect(parseScannedCode("5CD8123XYZ")).toMatchObject({ kind: "raw", value: "5CD8123XYZ" });
  });
});
