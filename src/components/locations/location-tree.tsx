"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building, Building2, ChevronDown, ChevronRight, DoorOpen, Layers, Loader2, MapPinned, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { deleteLocation, saveLocation } from "@/actions/locations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { LOCATION_TYPE_LABELS } from "@/lib/constants";
import { LOCATION_TYPES, type LocationTypeValue } from "@/lib/domain";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Loc {
  id: string;
  parentId: string | null;
  type: LocationTypeValue;
  code: string;
  name: string;
  path: string;
  pathIds: string;
  departmentId: string | null;
  address: string | null;
  active: boolean;
  assetCount: number;
}

const ICONS: Record<LocationTypeValue, React.ComponentType<{ className?: string }>> = {
  SITE: Building2,
  BUILDING: Building,
  FLOOR: Layers,
  DEPARTMENT: Users,
  ZONE: MapPinned,
  ROOM: DoorOpen,
};

const NEXT_TYPE: Record<LocationTypeValue, LocationTypeValue> = {
  SITE: "BUILDING",
  BUILDING: "FLOOR",
  FLOOR: "DEPARTMENT",
  DEPARTMENT: "ROOM",
  ZONE: "ROOM",
  ROOM: "ROOM",
};

interface FormState {
  id?: string;
  parentId: string;
  type: LocationTypeValue;
  code: string;
  name: string;
  departmentId: string;
  address: string;
  active: boolean;
}

export function LocationTree({ locations, departments, canEdit }: { locations: Loc[]; departments: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(locations.filter((l) => l.type === "SITE" || l.type === "BUILDING").map((l) => l.id)));
  const [form, setForm] = useState<FormState | null>(null);
  const [pending, start] = useTransition();

  const children = useMemo(() => {
    const map = new Map<string | null, Loc[]>();
    for (const l of locations) {
      const list = map.get(l.parentId) ?? [];
      list.push(l);
      map.set(l.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
    return map;
  }, [locations]);

  const subtreeCount = useMemo(() => {
    const totals = new Map<string, number>();
    for (const l of locations) {
      for (const id of l.pathIds.split("/").filter(Boolean)) totals.set(id, (totals.get(id) ?? 0) + l.assetCount);
    }
    return totals;
  }, [locations]);

  const openCreate = (parent: Loc | null) =>
    setForm({ parentId: parent?.id ?? "", type: parent ? NEXT_TYPE[parent.type] : "SITE", code: "", name: "", departmentId: "", address: "", active: true });
  const openEdit = (l: Loc) =>
    setForm({ id: l.id, parentId: l.parentId ?? "", type: l.type, code: l.code, name: l.name, departmentId: l.departmentId ?? "", address: l.address ?? "", active: l.active });

  const submit = () =>
    form &&
    start(async () => {
      const res = await saveLocation(form);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      if (form.parentId) setExpanded((s) => new Set(s).add(form.parentId));
      setForm(null);
      router.refresh();
    });

  const remove = (l: Loc) =>
    start(async () => {
      if (!window.confirm(`Supprimer « ${l.path} » ?`)) return;
      const res = await deleteLocation(l.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });

  const render = (parentId: string | null, depth: number): React.ReactNode =>
    (children.get(parentId) ?? []).map((l) => {
      const Icon = ICONS[l.type];
      const kids = children.get(l.id) ?? [];
      const isOpen = expanded.has(l.id);
      return (
        <li key={l.id}>
          <div className={cn("group flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-muted/50", !l.active && "opacity-50")} style={{ paddingLeft: depth * 20 + 4 }}>
            <button
              className="grid h-6 w-6 place-content-center rounded text-muted-foreground hover:bg-muted disabled:opacity-0"
              disabled={!kids.length}
              onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
              aria-label={isOpen ? "Replier" : "Déplier"}
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 truncate text-sm font-medium">{l.name}</span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{l.code}</span>
            <Badge variant="muted" className="hidden md:inline-flex">
              {LOCATION_TYPE_LABELS[l.type]}
            </Badge>
            <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular" title="Biens dans ce niveau et ses sous-niveaux">
              {formatNumber(subtreeCount.get(l.id) ?? 0)} bien(s)
            </span>
            {canEdit && (
              <span className="flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openCreate(l)} aria-label="Ajouter un sous-niveau">
                  <Plus />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(l)} aria-label="Modifier">
                  <Pencil />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(l)} aria-label="Supprimer">
                  <Trash2 />
                </Button>
              </span>
            )}
          </div>
          {isOpen && kids.length > 0 && <ul>{render(l.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <>
      <Card>
        <CardContent className="p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(locations.map((l) => l.id)))}>
                Tout déplier
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>
                Tout replier
              </Button>
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => openCreate(null)}>
                <Plus /> Nouveau site
              </Button>
            )}
          </div>
          {locations.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucune localisation. Commencez par créer un site.</p>
          ) : (
            <ul>{render(null, 0)}</ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Modifier la localisation" : "Nouvelle localisation"}</DialogTitle>
            <DialogDescription>
              {form?.parentId ? `Rattachée à : ${locations.find((l) => l.id === form.parentId)?.path}` : "Niveau racine (site / agence)."}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Libellé" required className="sm:col-span-2">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bureau 204" />
              </Field>
              <Field label="Code unique" required hint="Encodé dans le QR du local.">
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="CAS-E2-B204" className="font-mono" />
              </Field>
              <Field label="Type">
                <NativeSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LocationTypeValue })}>
                  {LOCATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {LOCATION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Niveau parent" className="sm:col-span-2">
                <NativeSelect value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                  <option value="">— Racine —</option>
                  {locations
                    .filter((l) => !form.id || (l.id !== form.id && !l.pathIds.includes(`/${form.id}/`)))
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.path}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="Direction rattachée">
                <NativeSelect value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Adresse (sites)">
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} /> Active
              </label>
            </div>
          )}
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !form?.name || !form?.code}>
              {pending && <Loader2 className="animate-spin" />} Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
