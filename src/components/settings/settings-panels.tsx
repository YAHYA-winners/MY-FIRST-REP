"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteReferential,
  saveCategory,
  saveCompany,
  saveCostCenter,
  saveDepartment,
  saveEmployee,
  saveSupplier,
  saveUser,
  type ReferentialKind,
} from "@/actions/referentials";
import type { ActionResult } from "@/lib/action-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEPRECIATION_METHOD_LABELS, ROLE_LABELS } from "@/lib/constants";
import { DEPRECIATION_METHODS, USER_ROLES, type DepreciationMethodValue, type UserRoleValue } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Generic entity editor
// ---------------------------------------------------------------------------

type Values = Record<string, string | boolean | string[]>;

interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "email" | "password" | "select" | "checkbox" | "multi";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  wide?: boolean;
}

interface Column<T> {
  label: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

function EntityPanel<T extends { id: string }>({
  title,
  description,
  rows,
  columns,
  fields,
  toValues,
  empty,
  save,
  deleteKind,
  canEdit,
}: {
  title: string;
  description?: string;
  rows: T[];
  columns: Column<T>[];
  fields: FieldDef[];
  toValues: (row: T | null) => Values;
  empty?: string;
  save: (values: Values) => Promise<ActionResult<null>>;
  deleteKind?: ReferentialKind;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id?: string; values: Values } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    editing &&
    start(async () => {
      const res = await save({ ...editing.values, ...(editing.id ? { id: editing.id } : {}) });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(res.message ?? "Enregistré.");
      setEditing(null);
      setErrors({});
      router.refresh();
    });

  const remove = (row: T) =>
    deleteKind &&
    start(async () => {
      if (!window.confirm("Supprimer cet élément ? (impossible s'il est déjà utilisé)")) return;
      const res = await deleteReferential(deleteKind, row.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });

  const set = (name: string, value: string | boolean | string[]) => setEditing((e) => (e ? { ...e, values: { ...e.values, [name]: value } } : e));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => { setErrors({}); setEditing({ values: toValues(null) }); }}>
            <Plus /> Ajouter
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{empty ?? "Aucun élément."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.label} className={c.className}>
                    {c.label}
                  </TableHead>
                ))}
                {canEdit && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((c) => (
                    <TableCell key={c.label} className={c.className}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  {canEdit && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setErrors({}); setEditing({ id: row.id, values: toValues(row) }); }} aria-label="Modifier">
                          <Pencil />
                        </Button>
                        {deleteKind && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => remove(row)} aria-label="Supprimer">
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Modifier" : "Ajouter"} — {title}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => {
                const value = editing.values[f.name];
                const err = errors[f.name];
                if (f.type === "checkbox") {
                  return (
                    <label key={f.name} className="flex items-center gap-2 text-sm sm:col-span-2">
                      <Checkbox checked={value === true} onCheckedChange={(v) => set(f.name, v === true)} /> {f.label}
                    </label>
                  );
                }
                if (f.type === "multi") {
                  const list = Array.isArray(value) ? value : [];
                  return (
                    <Field key={f.name} label={f.label} error={err} className="sm:col-span-2">
                      <div className="space-y-1 rounded-md border p-2">
                        {f.options?.map((o) => (
                          <label key={o.value} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={list.includes(o.value)}
                              onCheckedChange={(v) => set(f.name, v === true ? [...list, o.value] : list.filter((x) => x !== o.value))}
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </Field>
                  );
                }
                return (
                  <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={f.wide ? "sm:col-span-2" : undefined}>
                    {f.type === "select" ? (
                      <NativeSelect value={String(value ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                        {!f.required && <option value="">—</option>}
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Input
                        type={f.type ?? "text"}
                        step={f.type === "number" ? "any" : undefined}
                        value={String(value ?? "")}
                        onChange={(e) => set(f.name, e.target.value)}
                        autoComplete={f.type === "password" ? "new-password" : undefined}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Data contracts
// ---------------------------------------------------------------------------

export interface SettingsData {
  company: {
    name: string;
    legalName: string | null;
    legalForm: string | null;
    ice: string | null;
    taxId: string | null;
    tradeRegister: string | null;
    address: string | null;
    city: string | null;
    currency: string;
    capitalizationThreshold: number;
    fiscalYearStartMonth: number;
  };
  categories: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    assetAccount: string;
    depreciationAccount: string | null;
    defaultMethod: DepreciationMethodValue;
    defaultUsefulLifeYears: number;
    decliningCoefficient: number | null;
    trackPhysically: boolean;
    active: boolean;
    assetCount: number;
  }[];
  costCenters: { id: string; code: string; name: string; active: boolean }[];
  departments: { id: string; code: string; name: string; costCenterId: string | null; costCenterLabel: string | null; managerName: string | null; active: boolean }[];
  employees: {
    id: string;
    matricule: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    jobTitle: string | null;
    departmentId: string | null;
    departmentName: string | null;
    active: boolean;
  }[];
  suppliers: { id: string; name: string; ice: string | null; taxId: string | null; tradeRegister: string | null; address: string | null; city: string | null; email: string | null; phone: string | null }[];
  users: { id: string; email: string; name: string; role: UserRoleValue; active: boolean; lastLoginAt: string | null; companyIds: string[] }[];
  companies: { id: string; name: string }[];
}

const s = (v: string | null | undefined) => v ?? "";

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export function SettingsPanels({ data, canEditReferentials, canManageCompany, canManageUsers }: { data: SettingsData; canEditReferentials: boolean; canManageCompany: boolean; canManageUsers: boolean }) {
  const router = useRouter();
  const [company, setCompany] = useState({
    ...data.company,
    legalName: s(data.company.legalName),
    legalForm: s(data.company.legalForm),
    ice: s(data.company.ice),
    taxId: s(data.company.taxId),
    tradeRegister: s(data.company.tradeRegister),
    address: s(data.company.address),
    city: s(data.company.city),
    capitalizationThreshold: String(data.company.capitalizationThreshold),
    fiscalYearStartMonth: String(data.company.fiscalYearStartMonth),
  });
  const [pending, start] = useTransition();

  const methodOptions = DEPRECIATION_METHODS.map((m) => ({ value: m, label: DEPRECIATION_METHOD_LABELS[m] }));
  const costCenterOptions = data.costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
  const departmentOptions = data.departments.map((d) => ({ value: d.id, label: d.name }));

  return (
    <Tabs defaultValue="categories">
      <TabsList>
        <TabsTrigger value="company">Société</TabsTrigger>
        <TabsTrigger value="categories">Catégories comptables</TabsTrigger>
        <TabsTrigger value="costCenters">Centres de coût</TabsTrigger>
        <TabsTrigger value="departments">Directions</TabsTrigger>
        <TabsTrigger value="employees">Collaborateurs</TabsTrigger>
        <TabsTrigger value="suppliers">Fournisseurs</TabsTrigger>
        {canManageUsers && <TabsTrigger value="users">Utilisateurs</TabsTrigger>}
      </TabsList>

      <TabsContent value="company">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identité de la société</CardTitle>
            <CardDescription>Reprise sur les étiquettes, décharges et procès-verbaux d&apos;inventaire.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["name", "Nom usuel"],
                ["legalName", "Raison sociale"],
                ["legalForm", "Forme juridique"],
                ["ice", "ICE (15 chiffres)"],
                ["taxId", "Identifiant fiscal (IF)"],
                ["tradeRegister", "Registre de commerce (RC)"],
                ["address", "Adresse"],
                ["city", "Ville"],
                ["currency", "Devise (ISO)"],
                ["capitalizationThreshold", "Seuil d'immobilisation HT"],
                ["fiscalYearStartMonth", "Mois de début d'exercice (1-12)"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input value={company[key]} disabled={!canManageCompany} onChange={(e) => setCompany({ ...company, [key]: e.target.value })} />
              </Field>
            ))}
            {canManageCompany && (
              <div className="flex items-end">
                <Button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await saveCompany(company);
                      if (!res.ok) return void toast.error(res.error);
                      toast.success(res.message);
                      router.refresh();
                    })
                  }
                >
                  {pending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="categories">
        <EntityPanel
          title="Catégories comptables (CGNC)"
          description="Comptes d'immobilisation et d'amortissement, méthode et durée par défaut. Le code et la description guident la classification IA des factures."
          rows={data.categories}
          canEdit={canEditReferentials}
          deleteKind="category"
          save={saveCategory}
          columns={[
            { label: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: "Libellé", cell: (r) => <span className="font-medium">{r.name}</span> },
            { label: "Comptes", cell: (r) => <span className="font-mono text-xs">{r.assetAccount} / {r.depreciationAccount ?? "—"}</span>, className: "hidden md:table-cell" },
            { label: "Amortissement", cell: (r) => `${DEPRECIATION_METHOD_LABELS[r.defaultMethod]}${r.defaultMethod !== "NONE" ? ` · ${r.defaultUsefulLifeYears} ans` : ""}${r.decliningCoefficient ? ` · coef ${r.decliningCoefficient}` : ""}` },
            { label: "Biens", cell: (r) => r.assetCount, className: "hidden sm:table-cell text-right tabular" },
            { label: "Inventaire", cell: (r) => (r.trackPhysically ? <Badge variant="success">Physique</Badge> : <Badge variant="muted">Non inventorié</Badge>), className: "hidden lg:table-cell" },
          ]}
          fields={[
            { name: "code", label: "Code", required: true, hint: "Ex. INFO, MOB, TRANS" },
            { name: "name", label: "Libellé", required: true },
            { name: "assetAccount", label: "Compte d'immobilisation", required: true, hint: "Ex. 2355" },
            { name: "depreciationAccount", label: "Compte d'amortissement", hint: "Ex. 28355" },
            { name: "defaultMethod", label: "Méthode par défaut", type: "select", options: methodOptions, required: true },
            { name: "defaultUsefulLifeYears", label: "Durée (années)", type: "number", required: true },
            { name: "decliningCoefficient", label: "Coefficient dégressif", type: "number", hint: "Vide = barème fiscal (1,5 / 2 / 3)" },
            { name: "description", label: "Indices de classification (IA)", wide: true },
            { name: "trackPhysically", label: "Inclure dans les inventaires physiques", type: "checkbox" },
            { name: "active", label: "Active", type: "checkbox" },
          ]}
          toValues={(r) => ({
            code: s(r?.code),
            name: s(r?.name),
            description: s(r?.description),
            assetAccount: s(r?.assetAccount),
            depreciationAccount: s(r?.depreciationAccount),
            defaultMethod: r?.defaultMethod ?? "LINEAR",
            defaultUsefulLifeYears: String(r?.defaultUsefulLifeYears ?? 5),
            decliningCoefficient: r?.decliningCoefficient ? String(r.decliningCoefficient) : "",
            trackPhysically: r?.trackPhysically ?? true,
            active: r?.active ?? true,
          })}
        />
      </TabsContent>

      <TabsContent value="costCenters">
        <EntityPanel
          title="Centres de coût"
          rows={data.costCenters}
          canEdit={canEditReferentials}
          deleteKind="costCenter"
          save={saveCostCenter}
          columns={[
            { label: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: "Libellé", cell: (r) => r.name },
            { label: "Statut", cell: (r) => (r.active ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Inactif</Badge>) },
          ]}
          fields={[
            { name: "code", label: "Code", required: true },
            { name: "name", label: "Libellé", required: true },
            { name: "active", label: "Actif", type: "checkbox" },
          ]}
          toValues={(r) => ({ code: s(r?.code), name: s(r?.name), active: r?.active ?? true })}
        />
      </TabsContent>

      <TabsContent value="departments">
        <EntityPanel
          title="Directions / services"
          rows={data.departments}
          canEdit={canEditReferentials}
          deleteKind="department"
          save={saveDepartment}
          columns={[
            { label: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: "Libellé", cell: (r) => r.name },
            { label: "Centre de coût", cell: (r) => r.costCenterLabel ?? "—", className: "hidden md:table-cell" },
            { label: "Responsable", cell: (r) => r.managerName ?? "—", className: "hidden lg:table-cell" },
          ]}
          fields={[
            { name: "code", label: "Code", required: true },
            { name: "name", label: "Libellé", required: true },
            { name: "costCenterId", label: "Centre de coût", type: "select", options: costCenterOptions },
            { name: "managerName", label: "Responsable" },
            { name: "active", label: "Active", type: "checkbox" },
          ]}
          toValues={(r) => ({ code: s(r?.code), name: s(r?.name), costCenterId: s(r?.costCenterId), managerName: s(r?.managerName), active: r?.active ?? true })}
        />
      </TabsContent>

      <TabsContent value="employees">
        <EntityPanel
          title="Collaborateurs (détenteurs)"
          description="Bénéficiaires des affectations nominatives avec décharge signée."
          rows={data.employees}
          canEdit={canEditReferentials}
          deleteKind="employee"
          save={saveEmployee}
          columns={[
            { label: "Matricule", cell: (r) => <span className="font-mono text-xs">{r.matricule}</span> },
            { label: "Nom", cell: (r) => <span className="font-medium">{r.firstName} {r.lastName}</span> },
            { label: "Fonction", cell: (r) => r.jobTitle ?? "—", className: "hidden md:table-cell" },
            { label: "Direction", cell: (r) => r.departmentName ?? "—", className: "hidden lg:table-cell" },
            { label: "Statut", cell: (r) => (r.active ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Sorti</Badge>) },
          ]}
          fields={[
            { name: "matricule", label: "Matricule", required: true },
            { name: "jobTitle", label: "Fonction" },
            { name: "firstName", label: "Prénom", required: true },
            { name: "lastName", label: "Nom", required: true },
            { name: "email", label: "E-mail", type: "email" },
            { name: "phone", label: "Téléphone" },
            { name: "departmentId", label: "Direction", type: "select", options: departmentOptions, wide: true },
            { name: "active", label: "Actif", type: "checkbox" },
          ]}
          toValues={(r) => ({
            matricule: s(r?.matricule),
            firstName: s(r?.firstName),
            lastName: s(r?.lastName),
            email: s(r?.email),
            phone: s(r?.phone),
            jobTitle: s(r?.jobTitle),
            departmentId: s(r?.departmentId),
            active: r?.active ?? true,
          })}
        />
      </TabsContent>

      <TabsContent value="suppliers">
        <EntityPanel
          title="Fournisseurs"
          description="Alimentés automatiquement lors de la validation des factures (rapprochement par ICE)."
          rows={data.suppliers}
          canEdit={canEditReferentials}
          deleteKind="supplier"
          save={saveSupplier}
          columns={[
            { label: "Raison sociale", cell: (r) => <span className="font-medium">{r.name}</span> },
            { label: "ICE", cell: (r) => <span className="font-mono text-xs">{r.ice ?? "—"}</span> },
            { label: "Ville", cell: (r) => r.city ?? "—", className: "hidden md:table-cell" },
            { label: "Contact", cell: (r) => r.email ?? r.phone ?? "—", className: "hidden lg:table-cell" },
          ]}
          fields={[
            { name: "name", label: "Raison sociale", required: true, wide: true },
            { name: "ice", label: "ICE" },
            { name: "taxId", label: "IF" },
            { name: "tradeRegister", label: "RC" },
            { name: "city", label: "Ville" },
            { name: "address", label: "Adresse", wide: true },
            { name: "email", label: "E-mail" },
            { name: "phone", label: "Téléphone" },
          ]}
          toValues={(r) => ({
            name: s(r?.name),
            ice: s(r?.ice),
            taxId: s(r?.taxId),
            tradeRegister: s(r?.tradeRegister),
            address: s(r?.address),
            city: s(r?.city),
            email: s(r?.email),
            phone: s(r?.phone),
          })}
        />
      </TabsContent>

      {canManageUsers && (
        <TabsContent value="users">
          <EntityPanel
            title="Utilisateurs & habilitations"
            rows={data.users}
            canEdit
            save={saveUser}
            columns={[
              { label: "Nom", cell: (r) => <span className="font-medium">{r.name}</span> },
              { label: "E-mail", cell: (r) => r.email, className: "hidden md:table-cell" },
              { label: "Profil", cell: (r) => ROLE_LABELS[r.role] },
              { label: "Dernière connexion", cell: (r) => formatDateTime(r.lastLoginAt), className: "hidden lg:table-cell" },
              { label: "Statut", cell: (r) => (r.active ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Désactivé</Badge>) },
            ]}
            fields={[
              { name: "name", label: "Nom complet", required: true },
              { name: "email", label: "E-mail", type: "email", required: true },
              { name: "role", label: "Profil", type: "select", required: true, options: USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
              { name: "password", label: "Mot de passe", type: "password", hint: "10 caractères min. (laisser vide pour ne pas changer)" },
              { name: "companyIds", label: "Sociétés accessibles", type: "multi", options: data.companies.map((c) => ({ value: c.id, label: c.name })) },
              { name: "active", label: "Compte actif", type: "checkbox" },
            ]}
            toValues={(r) => ({
              name: s(r?.name),
              email: s(r?.email),
              role: r?.role ?? "AUDITOR",
              password: "",
              companyIds: r?.companyIds ?? data.companies.map((c) => c.id),
              active: r?.active ?? true,
            })}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
