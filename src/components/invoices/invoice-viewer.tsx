"use client";

import { useState } from "react";
import { ExternalLink, Maximize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Interactive document viewer: native PDF viewer, or image with zoom / rotation / pan. */
export function InvoiceViewer({ url, mimeType, fileName }: { url: string; mimeType: string; fileName: string }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const isPdf = mimeType === "application/pdf";
  const isHeic = mimeType === "image/heic" || mimeType === "image/heif";

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border bg-slate-800">
      <div className="flex items-center gap-1 border-b border-white/10 bg-slate-900 px-2 py-1.5 text-white">
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-slate-300" title={fileName}>
          {fileName}
        </span>
        {!isPdf && !isHeic && (
          <>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Zoom arrière">
              <ZoomOut />
            </Button>
            <span className="w-12 text-center text-xs tabular">{Math.round(zoom * 100)} %</span>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom avant">
              <ZoomIn />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Pivoter">
              <RotateCw />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" onClick={() => { setZoom(1); setRotation(0); }} aria-label="Ajuster">
              <Maximize2 />
            </Button>
          </>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/10 hover:text-white" asChild>
          <a href={url} target="_blank" rel="noreferrer" aria-label="Ouvrir dans un nouvel onglet">
            <ExternalLink />
          </a>
        </Button>
      </div>
      <div className="relative flex-1 overflow-auto scrollbar-thin">
        {isPdf ? (
          <iframe src={`${url}#view=FitH&toolbar=1`} title={fileName} className="h-full min-h-[600px] w-full bg-white" />
        ) : isHeic ? (
          <div className="grid h-full place-content-center p-6 text-center text-sm text-slate-300">
            Aperçu HEIC non pris en charge par ce navigateur.
            <a href={url} className="mt-2 underline" target="_blank" rel="noreferrer">
              Télécharger le fichier
            </a>
          </div>
        ) : (
          <div className="flex min-h-full items-start justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={fileName}
              draggable={false}
              className="max-w-none origin-center rounded bg-white shadow-xl transition-transform"
              style={{ width: `${zoom * 100}%`, transform: `rotate(${rotation}deg)` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
