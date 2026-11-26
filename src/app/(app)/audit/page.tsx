import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ChevronLeft, ChevronRight, MapPin, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import type { AssetEventTypeValue } from "@/lib/domain";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Journal d'audit" };

const PAGE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; user?: string; from?: string; to?: string; q?: string; page?: string }>;
}) {
  const { company } = await requirePageContext("audit:read");
  const f = await searchParams;
  const page = Math.max(1, Number.parseInt(f.page ?? "1", 10) || 1);
  const where: Prisma.AssetEventWhereInput = { companyId: company.id };
  if (f.type && f.type in EVENT_TYPE_LABELS) where.type = f.type as AssetEventTypeValue;
  if (f.user) where.userId = f.user;
  if (f.q) where.OR = [{ summary: { contains: f.q, mode: "insensitive" } }, { asset: { code: { contains: f.q, mode: "insensitive" } } }];
  const createdAt: Prisma.DateTimeFilter = {};
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) createdAt.gte = new Date(`${f.from}T00:00:00Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) createdAt.lte = new Date(`${f.to}T23:59:59Z`);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  const [events, total, users] = await Promise.all([
    prisma.assetEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        asset: { select: { id: true, code: true } },
        user: { select: { name: true } },
        campaign: { select: { id: true, code: true } },
      },
    }),
    prisma.assetEvent.count({ where }),
    prisma.user.findMany({ where: { memberships: { some: { companyId: company.id } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: number) => {
    const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    params.set("page", String(p));
    return `/audit?${params}`;
  };

  return (
    <div>
      <PageHeader
        title="Journal d'audit immuable"
        description={
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-success" /> Tous les mouvements, affectations, changements de statut et scans — en ajout seul, verrouillé au niveau de la base de données.
          </span>
        }
      />
      <Card className="mb-4 p-3">
        <form className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" method="GET">
          <Input name="q" defaultValue={f.q} placeholder="Code bien ou texte…" />
          <NativeSelect name="type" defaultValue={f.type ?? ""} aria-label="Type d'événement">
            <option value="">Tous les événements</option>
            {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="user" defaultValue={f.user ?? ""} aria-label="Utilisateur">
            <option value="">Tous les utilisateurs</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" name="from" defaultValue={f.from} aria-label="Du" />
          <Input type="date" name="to" defaultValue={f.to} aria-label="Au" />
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Horodatage</TableHead>
              <TableHead>Événement</TableHead>
              <TableHead>Bien</TableHead>
              <TableHead>Détail</TableHead>
              <TableHead className="hidden md:table-cell">Utilisateur</TableHead>
              <TableHead className="hidden lg:table-cell">Contexte</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs tabular">{formatDateTime(e.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="muted">{EVENT_TYPE_LABELS[e.type]}</Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/assets/${e.asset.id}`} className="font-mono text-xs text-primary hover:underline">
                    {e.asset.code}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[420px] text-sm">{e.summary}</TableCell>
                <TableCell className="hidden text-sm md:table-cell">{e.user?.name ?? "Système"}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  <span className="flex flex-wrap items-center gap-2">
                    {e.campaign && (
                      <Link href={`/campaigns/${e.campaign.id}`} className="text-primary hover:underline">
                        {e.campaign.code}
                      </Link>
                    )}
                    {e.latitude !== null && e.longitude !== null && (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" /> {e.latitude.toFixed(5)}, {e.longitude.toFixed(5)}
                      </span>
                    )}
                    {e.ipAddress && <span>IP {e.ipAddress}</span>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Aucun événement.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {formatNumber(total)} événement(s) — page {page} / {pages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={href(Math.max(1, page - 1))} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
                <ChevronLeft /> Précédent
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={href(Math.min(pages, page + 1))} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
                Suivant <ChevronRight />
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
