"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Ban, Loader2, Pencil, RefreshCcw, Undo2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { assignCustodian, changeAssetStatus, disposeAsset, returnAsset, transferAssets } from "@/actions/assets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS, DISPOSAL_TYPE_LABELS } from "@/lib/constants";
import {
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  DISPOSAL_TYPES,
  type AssetConditionValue,
  type AssetStatusValue,
  type DisposalTypeValue,
} from "@/lib/domain";
import { formatMoney, todayInput } from "@/lib/format";

interface Option {
  id: string;
  label: string;
}

export interface AssetActionsProps {
  asset: { id: string; code: string; status: AssetStatusValue; condition: AssetConditionValue; custodianName: string | null; locationId: string | null; netBookValue: number };
  currency: string;
  locations: Option[];
  employees: Option[];
  departments: Option[];
  costCenters: Option[];
  permissions: { write: boolean; transfer: boolean; assign: boolean; dispose: boolean };
}

type DialogKind = "transfer" | "assign" | "return" | "status" | "dispose" | null;

export function AssetActions({ asset, currency, locations, employees, departments, costCenters, permissions }: AssetActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogKind>(null);
  const [pending, start] = useTransition();
  const disposed = asset.status === "DISPOSED";

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Opération enregistrée.");
      setOpen(null);
      router.refresh();
    });

  // --- transfer
  const [locationId, setLocationId] = useState(asset.locationId ?? "");
  const [departmentId, setDepartmentId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  // --- assign
  const signature = useRef<SignaturePadHandle>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [assignCondition, setAssignCondition] = useState<AssetConditionValue>(asset.condition);
  const [assignNotes, setAssignNotes] = useState("");
  // --- return
  const [returnCondition, setReturnCondition] = useState<AssetConditionValue>(asset.condition);
  const [returnNotes, setReturnNotes] = useState("");
  // --- status
  const [status, setStatus] = useState<AssetStatusValue>(asset.status === "DISPOSED" ? "IN_STOCK" : asset.status);
  const [condition, setCondition] = useState<AssetConditionValue>(asset.condition);
  const [statusReason, setStatusReason] = useState("");
  // --- dispose
  const [disposalDate, setDisposalDate] = useState(todayInput());
  const [disposalType, setDisposalType] = useState<DisposalTypeValue>("DESTRUCTION");
  const [disposalValue, setDisposalValue] = useState("");
  const [disposalReason, setDisposalReason] = useState("");

  if (disposed) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {permissions.write && (
        <Button variant="outline" asChild>
          <Link href={`/assets/${asset.id}/edit`}>
            <Pencil /> Modifier
          </Link>
        </Button>
      )}
      {permissions.transfer && (
        <Button variant="outline" onClick={() => setOpen("transfer")}>
          <ArrowLeftRight /> Transférer
        </Button>
      )}
      {permissions.assign && (
        <Button variant="outline" onClick={() => setOpen("assign")}>
          <UserCheck /> {asset.custodianName ? "Réaffecter" : "Affecter"}
        </Button>
      )}
      {permissions.assign && asset.custodianName && (
        <Button variant="outline" onClick={() => setOpen("return")}>
          <Undo2 /> Restitution
        </Button>
      )}
      {permissions.write && (
        <Button variant="outline" onClick={() => setOpen("status")}>
          <RefreshCcw /> Statut / état
        </Button>
      )}
      {permissions.dispose && (
        <Button variant="destructive" onClick={() => setOpen("dispose")}>
          <Ban /> Sortie d&apos;actif
        </Button>
      )}

      <Dialog open={open === "transfer"} onOpenChange={(o) => setOpen(o ? "transfer" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfert de localisation</DialogTitle>
            <DialogDescription>Le mouvement est horodaté et tracé dans l&apos;historique immuable ({asset.code}).</DialogDescription>
          </DialogHeader>
          <Field label="Nouvelle localisation" required>
            <NativeSelect value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— Sélectionner —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nouvelle direction (optionnel)">
              <NativeSelect value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Inchangée</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Nouveau centre de coût (optionnel)">
              <NativeSelect value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                <option value="">Inchangé</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Motif">
            <Input value={transferReason} onChange={(e) => setTransferReason(e.target.value)} placeholder="Réorganisation, déménagement…" />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || !locationId}
              onClick={() =>
                run(() => transferAssets({ assetIds: [asset.id], locationId, departmentId, costCenterId, reason: transferReason }))
              }
            >
              {pending && <Loader2 className="animate-spin" />} Valider le transfert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "assign"} onOpenChange={(o) => setOpen(o ? "assign" : null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Affectation nominative avec décharge signée</DialogTitle>
            <DialogDescription>
              Le collaborateur signe directement sur l&apos;écran. La signature, l&apos;horodatage et l&apos;adresse IP sont conservés.
            </DialogDescription>
          </DialogHeader>
          <Field label="Collaborateur" required>
            <NativeSelect
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                const emp = employees.find((x) => x.id === e.target.value);
                if (emp) setSignerName(emp.label.split(" (")[0]);
              }}
            >
              <option value="">— Sélectionner —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom du signataire" required>
              <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
            </Field>
            <Field label="État à la remise">
              <NativeSelect value={assignCondition} onChange={(e) => setAssignCondition(e.target.value as AssetConditionValue)}>
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CONDITION_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Observations">
            <Input value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} placeholder="Accessoires remis : chargeur, sacoche…" />
          </Field>
          <Field label="Signature du bénéficiaire" required>
            <SignaturePad ref={signature} />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || !employeeId || !signerName.trim()}
              onClick={() => {
                if (!signature.current || signature.current.isEmpty()) return void toast.error("La signature du bénéficiaire est obligatoire.");
                run(() =>
                  assignCustodian({
                    assetId: asset.id,
                    employeeId,
                    condition: assignCondition,
                    signerName,
                    signatureDataUrl: signature.current!.toDataURL(),
                    notes: assignNotes,
                  }),
                );
              }}
            >
              {pending && <Loader2 className="animate-spin" />} Valider la remise signée
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "return"} onOpenChange={(o) => setOpen(o ? "return" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restitution du bien</DialogTitle>
            <DialogDescription>Détenteur actuel : {asset.custodianName}. Le bien repassera « En stock / Non affecté ».</DialogDescription>
          </DialogHeader>
          <Field label="État constaté au retour">
            <NativeSelect value={returnCondition} onChange={(e) => setReturnCondition(e.target.value as AssetConditionValue)}>
              {ASSET_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CONDITION_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Observations">
            <Textarea value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button disabled={pending} onClick={() => run(() => returnAsset({ assetId: asset.id, condition: returnCondition, notes: returnNotes }))}>
              {pending && <Loader2 className="animate-spin" />} Enregistrer la restitution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "status"} onOpenChange={(o) => setOpen(o ? "status" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changement de statut / d&apos;état</DialogTitle>
            <DialogDescription>Le motif est obligatoire et conservé dans le journal d&apos;audit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Statut">
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as AssetStatusValue)}>
                {ASSET_STATUSES.filter((s) => s !== "DISPOSED").map((s) => (
                  <option key={s} value={s}>
                    {ASSET_STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="État physique">
              <NativeSelect value={condition} onChange={(e) => setCondition(e.target.value as AssetConditionValue)}>
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CONDITION_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Motif" required>
            <Textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="Panne écran, envoi chez le prestataire…" />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending || statusReason.trim().length < 1}
              onClick={() => run(() => changeAssetStatus({ assetId: asset.id, status, condition, reason: statusReason }))}
            >
              {pending && <Loader2 className="animate-spin" />} Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "dispose"} onOpenChange={(o) => setOpen(o ? "dispose" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sortie d&apos;actif (cession / mise au rebut)</DialogTitle>
            <DialogDescription>
              Opération irréversible. La dotation est calculée jusqu&apos;à la date de sortie ; VNC actuelle : {formatMoney(asset.netBookValue, currency)}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date de sortie" required>
              <Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} />
            </Field>
            <Field label="Nature de la sortie" required>
              <NativeSelect value={disposalType} onChange={(e) => setDisposalType(e.target.value as DisposalTypeValue)}>
                {DISPOSAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DISPOSAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label={`Prix de cession HT (${currency})`} hint="Laisser vide pour une destruction ou un don.">
            <Input type="number" step="0.01" min={0} value={disposalValue} onChange={(e) => setDisposalValue(e.target.value)} />
          </Field>
          <Field label="Motif / référence (PV de destruction, acte de cession…)" required>
            <Textarea value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || !disposalReason.trim()}
              onClick={() =>
                run(() =>
                  disposeAsset({ assetId: asset.id, disposalDate, disposalType, disposalValue, reason: disposalReason }),
                )
              }
            >
              {pending && <Loader2 className="animate-spin" />} Confirmer la sortie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
