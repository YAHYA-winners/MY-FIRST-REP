"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { createCampaign, previewCampaignScope } from "@/actions/campaigns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LOCATION_TYPE_LABELS, ROLE_LABELS } from "@/lib/constants";
import type { LocationTypeValue, UserRoleValue } from "@/lib/domain";
import { formatMoney, formatNumber } from "@/lib/format";

interface Props {
  locations: { id: string; parentId: string | null; name: string; path: string; type: LocationTypeValue; depth: number }[];
  categories: { id: string; name: string; assetAccount: string; trackPhysically: boolean }[];
  users: { id: string; name: string; role: UserRoleValue }[];
}

export function CampaignForm({ locations, categories, users }: Props) {
  const router = useRouter();
  const [name, setName] = useState(`Inventaire annuel ${new Date().getFullYear()}`);
  const [description, setDescription] = useState("");
  const [plannedStartDate, setStart] = useState("");
  const [plannedEndDate, setEnd] = useState("");
  const [locationIds, setLocationIds] = useState<Set<string>>(new Set());
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [leadId, setLeadId] = useState("");
  const [preview, setPreview] = useState<{ count: number; grossValue: number } | null>(null);
  const [pending, start] = useTransition();

  const ancestorsSelected = useMemo(() => {
    const byId = new Map(locations.map((l) => [l.id, l]));
    const covered = new Set<string>();
    for (const l of locations) {
      let p = l.parentId;
      while (p) {
        if (locationIds.has(p)) {
          covered.add(l.id);
          break;
        }
        p = byId.get(p)?.parentId ?? null;
      }
    }
    return covered;
  }, [locations, locationIds]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      const res = await previewCampaignScope({ locationIds: [...locationIds], categoryIds: [...categoryIds] });
      if (res.ok) setPreview(res.data);
    }, 300);
    return () => clearTimeout(handle);
  }, [locationIds, categoryIds]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const submit = () =>
    start(async () => {
      const res = await createCampaign({
        name,
        description,
        plannedStartDate: plannedStartDate || null,
        plannedEndDate: plannedEndDate || null,
        locationIds: [...locationIds].filter((id) => !ancestorsSelected.has(id)),
        categoryIds: [...categoryIds],
        memberIds: [...memberIds],
        leadId: leadId || null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Campagne ${res.data.code} créée.`);
      router.push(`/campaigns/${res.data.id}`);
    });

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informations générales</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Libellé" required className="sm:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Début prévu">
              <Input type="date" value={plannedStartDate} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Fin prévue">
              <Input type="date" value={plannedEndDate} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="Instructions aux équipes" className="sm:col-span-2">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Méthodologie, consignes de comptage, contacts…" />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Périmètre géographique</CardTitle>
            <CardDescription>Cocher un niveau inclut automatiquement tous ses sous-niveaux. Aucune sélection = toute la société.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-[420px] space-y-0.5 overflow-y-auto rounded-md border p-2 scrollbar-thin">
              {locations.map((l) => {
                const covered = ancestorsSelected.has(l.id);
                return (
                  <li key={l.id} style={{ paddingLeft: l.depth * 18 }}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                      <Checkbox checked={covered || locationIds.has(l.id)} disabled={covered} onCheckedChange={() => toggle(locationIds, setLocationIds, l.id)} />
                      <span className="truncate">{l.name}</span>
                      <span className="text-xs text-muted-foreground">{LOCATION_TYPE_LABELS[l.type]}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Catégories d&apos;actifs</CardTitle>
            <CardDescription>Aucune sélection = toutes les catégories suivies physiquement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={categoryIds.has(c.id)} onCheckedChange={() => toggle(categoryIds, setCategoryIds, c.id)} disabled={!c.trackPhysically} />
                <span className="font-mono text-xs text-muted-foreground">{c.assetAccount}</span> {c.name}
                {!c.trackPhysically && <span className="text-xs text-muted-foreground">(non inventorié)</span>}
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Équipe d&apos;inventaire</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Responsable de l'inventaire">
              <NativeSelect value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="space-y-1.5">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={memberIds.has(u.id) || leadId === u.id} disabled={leadId === u.id} onCheckedChange={() => toggle(memberIds, setMemberIds, u.id)} />
                  {u.name} <span className="text-xs text-muted-foreground">· {ROLE_LABELS[u.role]}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-accent/40">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium">Fichier théorique estimé</p>
            <p className="text-2xl font-semibold tabular">{preview ? formatNumber(preview.count) : "…"} biens</p>
            <p className="text-muted-foreground">Valeur brute : {preview ? formatMoney(preview.grossValue) : "…"}</p>
          </CardContent>
        </Card>
        <Button size="lg" className="w-full" onClick={submit} disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Créer la campagne
        </Button>
      </div>
    </div>
  );
}
