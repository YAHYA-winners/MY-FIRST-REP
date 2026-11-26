"use client";

import { QRCodeSVG } from "qrcode.react";

/** Client boundary for qrcode.react (it relies on hooks and has no "use client" directive). */
export function QrCode({ value, size = 156, title }: { value: string; size?: number; title?: string }) {
  return <QRCodeSVG value={value} size={size} level="M" marginSize={0} title={title} />;
}
