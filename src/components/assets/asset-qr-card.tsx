"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { markLabelsPrinted } from "@/actions/labels";
import { buildLabelsPdf, openPdfForPrint } from "@/lib/exports/labels-pdf";
import { LABEL_TEMPLATES } from "@/lib/labels";
import { assetQrPayload } from "@/lib/codes";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

export function AssetQrCard({
  asset,
  companyName,
  appUrl,
  canPrint,
}: {
  asset: { id: string; code: string; designation: string; location: string | null };
  companyName: string;
  appUrl: string;
  canPrint: boolean;
}) {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState("thermal-50x25");
  const [pending, start] = useTransition();
  const payload = assetQrPayload(asset.code, appUrl);

  const print = () =>
    start(async () => {
      const template = LABEL_TEMPLATES.find((t) => t.key === templateKey) ?? LABEL_TEMPLATES[0];
      try {
        const doc = await buildLabelsPdf(
          [{ id: asset.id, code: asset.code, qrPayload: payload, title: asset.designation, subtitle: asset.location }],
          { template, companyName, showCompany: true, showTitle: true, showSubtitle: true, startPosition: 0, drawBorders: template.kind !== "thermal" },
        );
        openPdfForPrint(doc, `Etiquette_${asset.code}.pdf`);
        const res = await markLabelsPrinted({ assetIds: [asset.id], templateKey });
        if (!res.ok) toast.error(res.error);
        else router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Impossible de générer l'étiquette.");
      }
    });

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-lg border bg-white p-3">
        <QRCodeSVG value={payload} size={148} level="M" marginSize={0} title={`QR ${asset.code}`} />
      </div>
      <p className="font-mono text-sm font-semibold">{asset.code}</p>
      <p className="max-w-full break-all text-center text-[11px] text-muted-foreground">{payload}</p>
      {canPrint && (
        <div className="flex w-full gap-2">
          <NativeSelect value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} aria-label="Format d'étiquette" className="text-xs">
            {LABEL_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <Button onClick={print} disabled={pending} size="icon" aria-label="Imprimer l'étiquette" className="shrink-0">
            {pending ? <Loader2 className="animate-spin" /> : <Printer />}
          </Button>
        </div>
      )}
    </div>
  );
}
