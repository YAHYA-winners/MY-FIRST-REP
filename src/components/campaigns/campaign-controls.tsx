"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { closeCount, deleteCampaign, launchCampaign, reopenCount } from "@/actions/campaigns";
import { Button } from "@/components/ui/button";
import type { CampaignStatusValue } from "@/lib/domain";

export function CampaignControls({ campaignId, status, canManage }: { campaignId: string; status: CampaignStatusValue; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, confirmText?: string, redirectTo?: string) =>
    start(async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Opération effectuée.");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && (
        <>
          <Button variant="outline" disabled={pending} onClick={() => run(() => deleteCampaign(campaignId), "Supprimer cette campagne en préparation ?", "/campaigns")}>
            <Trash2 /> Supprimer
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => launchCampaign(campaignId),
                "Lancer la campagne ? Le fichier comptable théorique (biens attendus, localisations, VNC) sera figé à cet instant.",
              )
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Play />} Lancer & figer le fichier théorique
          </Button>
        </>
      )}
      {status === "IN_PROGRESS" && (
        <Button
          variant="warning"
          disabled={pending}
          onClick={() => run(() => closeCount(campaignId), "Clôturer le comptage ? Plus aucun scan ne sera accepté ; le rapprochement sera calculé.")}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Lock />} Clôturer le comptage
        </Button>
      )}
      {status === "COUNT_CLOSED" && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => reopenCount(campaignId), "Réouvrir le comptage ?")}>
          <RotateCcw /> Réouvrir le comptage
        </Button>
      )}
    </div>
  );
}
