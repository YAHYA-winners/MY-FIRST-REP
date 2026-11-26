"use client";

import { useState, useTransition } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRegisterExport } from "@/actions/assets";
import { exportRegisterWorkbook } from "@/lib/exports/register-xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { todayInput } from "@/lib/format";

export function RegisterExportButton() {
  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState(todayInput());
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const res = await getRegisterExport({ asOf, includeDisposed });
      if (!res.ok) return void toast.error(res.error);
      exportRegisterWorkbook(res.data);
      toast.success(`${res.data.rows.length} immobilisations exportées.`);
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet /> Export balance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export du fichier des immobilisations</DialogTitle>
          <DialogDescription>Classeur Excel : balance par compte CGNC + détail bien par bien (amortissements recalculés à la date d&apos;arrêté).</DialogDescription>
        </DialogHeader>
        <Field label="Date d'arrêté" htmlFor="asOf">
          <Input id="asOf" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={includeDisposed} onCheckedChange={(v) => setIncludeDisposed(v === true)} />
          Inclure les biens sortis de l&apos;actif
        </label>
        <DialogFooter>
          <Button onClick={run} disabled={pending || !asOf}>
            {pending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Générer le classeur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
