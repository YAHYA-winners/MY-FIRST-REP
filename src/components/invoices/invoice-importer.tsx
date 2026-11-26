"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, CloudUpload, Copy, FileText, Image as ImageIcon, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, uniqueId } from "@/lib/utils";

type QueueStatus = "queued" | "uploading" | "uploaded" | "extracting" | "extracted" | "failed" | "duplicate";

interface QueueItem {
  localId: string;
  file: File;
  status: QueueStatus;
  invoiceId?: string;
  message?: string;
  stats?: { lines: number; assets: number; confidence: number; durationMs: number };
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const EXTRACTION_CONCURRENCY = 2;

const STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "En file d'attente",
  uploading: "Envoi…",
  uploaded: "Déposée",
  extracting: "Extraction IA…",
  extracted: "Extraite",
  failed: "Échec",
  duplicate: "Doublon",
};

export function InvoiceImporter({ aiConfigured, maxMb }: { aiConfigured: boolean; maxMb: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (localId: string, update: Partial<QueueItem>) =>
    setQueue((q) => q.map((item) => (item.localId === localId ? { ...item, ...update } : item)));

  const extract = useCallback(async (item: QueueItem) => {
    patch(item.localId, { status: "extracting", message: undefined });
    try {
      const res = await fetch(`/api/invoices/${item.invoiceId}/extract`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        patch(item.localId, { status: "failed", message: body.error ?? `Erreur HTTP ${res.status}` });
        return;
      }
      patch(item.localId, {
        status: "extracted",
        stats: { lines: body.lines, assets: body.assets, confidence: body.confidence, durationMs: body.durationMs },
      });
    } catch {
      patch(item.localId, { status: "failed", message: "Connexion interrompue pendant l'extraction." });
    }
  }, []);

  const process = useCallback(
    async (items: QueueItem[]) => {
      setBusy(true);
      items.forEach((i) => patch(i.localId, { status: "uploading" }));
      const form = new FormData();
      items.forEach((i) => form.append("files", i.file));
      let uploaded: QueueItem[] = [];
      try {
        const res = await fetch("/api/invoices/upload", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Erreur HTTP ${res.status}`);
        const results = body.results as { id: string; fileName: string; status: string; duplicate: boolean; error?: string }[];
        uploaded = items.flatMap((item, idx) => {
          const r = results[idx];
          if (!r || r.error) {
            patch(item.localId, { status: "failed", message: r?.error ?? "Échec de l'envoi." });
            return [];
          }
          if (r.duplicate) {
            patch(item.localId, { status: "duplicate", invoiceId: r.id, message: "Ce document a déjà été déposé." });
            return [];
          }
          patch(item.localId, { status: "uploaded", invoiceId: r.id });
          return [{ ...item, invoiceId: r.id, status: "uploaded" as const }];
        });
      } catch (e) {
        items.forEach((i) => patch(i.localId, { status: "failed", message: e instanceof Error ? e.message : "Échec de l'envoi." }));
      }

      if (aiConfigured && uploaded.length) {
        const pending = [...uploaded];
        const workers = Array.from({ length: Math.min(EXTRACTION_CONCURRENCY, pending.length) }, async () => {
          while (pending.length) {
            const next = pending.shift();
            if (next) await extract(next);
          }
        });
        await Promise.all(workers);
      }
      setBusy(false);
      router.refresh();
    },
    [aiConfigured, extract, router],
  );

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const accepted: QueueItem[] = [];
    for (const file of list) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)) {
        toast.error(`« ${file.name} » : format non supporté.`);
        continue;
      }
      if (file.size > maxMb * 1024 * 1024) {
        toast.error(`« ${file.name} » dépasse ${maxMb} Mo.`);
        continue;
      }
      accepted.push({ localId: uniqueId(), file, status: "queued" });
    }
    if (!accepted.length) return;
    if (accepted.length > 20) {
      toast.error("20 fichiers maximum par lot.");
      return;
    }
    setQueue((q) => [...accepted, ...q]);
    void process(accepted);
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card px-6 py-12 text-center transition-colors",
          dragging ? "border-primary bg-accent" : "border-input hover:border-primary/60 hover:bg-accent/40",
        )}
      >
        <div className="grid h-14 w-14 place-content-center rounded-full bg-primary/10 text-primary">
          <CloudUpload className="h-7 w-7" />
        </div>
        <div>
          <p className="font-medium">Glissez-déposez vos factures fournisseurs ici</p>
          <p className="text-sm text-muted-foreground">
            PDF, JPG, PNG, WebP, HEIC — jusqu&apos;à 20 fichiers par lot, {maxMb} Mo maximum chacun.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          Parcourir les fichiers
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {aiConfigured ? "Extraction automatique par Gemini 2.5 Flash (sortie JSON structurée)." : "IA non configurée : les documents seront déposés pour saisie manuelle."}
        </p>
      </div>

      {queue.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Lot en cours ({queue.length})</CardTitle>
            {!busy && (
              <Button variant="ghost" size="sm" onClick={() => setQueue([])}>
                <X /> Vider
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {queue.map((item) => {
                const isPdf = item.file.name.toLowerCase().endsWith(".pdf");
                return (
                  <li key={item.localId} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {isPdf ? <FileText className="h-5 w-5 shrink-0 text-red-600" /> : <ImageIcon className="h-5 w-5 shrink-0 text-sky-600" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(item.file.size / 1024 / 1024).toFixed(2)} Mo
                          {item.stats &&
                            ` · ${item.stats.lines} ligne(s), ${item.stats.assets} immobilisable(s) · confiance ${Math.round(item.stats.confidence * 100)} % · ${(item.stats.durationMs / 1000).toFixed(1)} s`}
                          {item.message && <span className={item.status === "failed" ? "text-destructive" : ""}> · {item.message}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          item.status === "extracted"
                            ? "success"
                            : item.status === "failed"
                              ? "destructive"
                              : item.status === "duplicate"
                                ? "warning"
                                : "info"
                        }
                      >
                        {["uploading", "extracting"].includes(item.status) && <Loader2 className="h-3 w-3 animate-spin" />}
                        {item.status === "extracted" && <CheckCircle2 className="h-3 w-3" />}
                        {item.status === "failed" && <AlertCircle className="h-3 w-3" />}
                        {item.status === "duplicate" && <Copy className="h-3 w-3" />}
                        {STATUS_LABEL[item.status]}
                      </Badge>
                      {item.status === "failed" && item.invoiceId && aiConfigured && (
                        <Button size="sm" variant="outline" onClick={() => extract(item)}>
                          Relancer
                        </Button>
                      )}
                      {item.invoiceId && ["extracted", "uploaded", "failed", "duplicate"].includes(item.status) && (
                        <Button size="sm" asChild>
                          <Link href={`/invoices/import/${item.invoiceId}`}>Vérifier</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
