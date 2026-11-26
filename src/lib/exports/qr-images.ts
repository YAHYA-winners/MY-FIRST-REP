import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QRCodeCanvas } from "qrcode.react";

const CHUNK = 60;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renders QR codes with qrcode.react off-screen and returns PNG data URLs
 * (used to embed crisp QR images in jsPDF label sheets).
 */
export async function renderQrDataUrls(payloads: string[], sizePx = 360): Promise<string[]> {
  const out: string[] = [];
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;";
  document.body.appendChild(container);
  try {
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const chunk = payloads.slice(i, i + CHUNK);
      const host = document.createElement("div");
      container.appendChild(host);
      const root = createRoot(host);
      flushSync(() => {
        root.render(
          createElement(
            "div",
            null,
            chunk.map((value, k) => createElement(QRCodeCanvas, { key: k, value, size: sizePx, level: "M", marginSize: 0 })),
          ),
        );
      });
      // QRCodeCanvas paints in an effect: wait until every canvas is drawn.
      for (let attempt = 0; attempt < 20; attempt++) {
        await wait(attempt === 0 ? 0 : 16);
        const canvases = host.querySelectorAll("canvas");
        if (canvases.length === chunk.length && [...canvases].every((c) => c.width > 0)) break;
      }
      host.querySelectorAll("canvas").forEach((c) => out.push(c.toDataURL("image/png")));
      root.unmount();
      host.remove();
    }
  } finally {
    container.remove();
  }
  if (out.length !== payloads.length) throw new Error("Génération des QR codes incomplète.");
  return out;
}
