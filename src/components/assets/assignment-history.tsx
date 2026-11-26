"use client";

import { useTransition } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateHandoverPdf, type HandoverData } from "@/lib/exports/handover-pdf";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export interface AssignmentView {
  id: string;
  employeeName: string;
  matricule: string;
  assignedAt: string;
  returnedAt: string | null;
  signatureKey: string | null;
  pdf: Omit<HandoverData, "signatureUrl">;
}

export function AssignmentHistory({ items }: { items: AssignmentView[] }) {
  const [pending, start] = useTransition();
  if (!items.length) return <p className="text-sm text-muted-foreground">Aucune affectation enregistrée.</p>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{a.employeeName}</p>
              <p className="text-xs text-muted-foreground">
                {a.matricule} · remis le {formatDateTime(a.assignedAt)}
              </p>
              {a.returnedAt ? (
                <Badge variant="muted" className="mt-1">
                  Restitué le {formatDateTime(a.returnedAt)}
                </Badge>
              ) : (
                <Badge variant="success" className="mt-1">
                  Détenteur actuel
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Télécharger la décharge PDF"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    await generateHandoverPdf({ ...a.pdf, signatureUrl: a.signatureKey ? `/api/files/${a.signatureKey}` : null });
                  } catch {
                    toast.error("Impossible de générer la décharge.");
                  }
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <FileDown />}
            </Button>
          </div>
          {a.signatureKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${a.signatureKey}`} alt={`Signature de ${a.employeeName}`} className="mt-2 h-14 rounded border bg-white object-contain" />
          )}
        </li>
      ))}
    </ul>
  );
}
