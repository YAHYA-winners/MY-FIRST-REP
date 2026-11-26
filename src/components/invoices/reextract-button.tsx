"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ReextractButton({ invoiceId, label = "Extraire", variant = "outline" }: { invoiceId: string; label?: string; variant?: "outline" | "default" | "secondary" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/invoices/${invoiceId}/extract`, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) toast.error(body.error ?? "Échec de l'extraction.");
          else toast.success(`Extraction terminée : ${body.lines} ligne(s), ${body.assets} immobilisable(s).`);
        } catch {
          toast.error("Connexion interrompue.");
        } finally {
          setBusy(false);
          router.refresh();
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {busy ? "Extraction…" : label}
    </Button>
  );
}
