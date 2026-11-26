"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { AXIS_TEXT, GRID_STROKE, NEUTRAL_FILL, SERIES, SURFACE } from "@/lib/chart-palette";
import { formatCompactNumber, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Payload = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

function ChartTooltip({
  active,
  payload,
  label,
  format,
  extra,
}: TooltipProps<number, string> & { format: (v: number) => string; extra?: (p: Record<string, unknown>) => React.ReactNode }) {
  const items = (payload ?? []) as Payload[];
  if (!active || !items.length) return null;
  return (
    <div className="min-w-[180px] rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-foreground">{label}</p>
      <ul className="space-y-1">
        {items.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular text-foreground">{format(Number(p.value ?? 0))}</span>
          </li>
        ))}
      </ul>
      {extra && items[0]?.payload && <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{extra(items[0].payload)}</div>}
    </div>
  );
}

function LegendText(value: string) {
  return <span className="text-xs text-muted-foreground">{value}</span>;
}

const axisProps = { stroke: GRID_STROKE, tick: { fill: AXIS_TEXT, fontSize: 11 }, tickLine: false } as const;

export function CategoryChart({ data, currency }: { data: { name: string; gross: number; nbv: number; count: number }[]; currency: string }) {
  if (!data.length) return <EmptyChart />;
  const height = Math.max(220, data.length * 44 + 60);
  return (
    <div style={{ height }} role="img" aria-label="Valeur brute et VNC par catégorie d'immobilisation">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
          <XAxis type="number" {...axisProps} tickFormatter={(v: number) => formatCompactNumber(v)} />
          <YAxis type="category" dataKey="name" width={150} {...axisProps} axisLine={false} />
          <Tooltip
            cursor={{ fill: "hsl(220 14% 96%)" }}
            content={<ChartTooltip format={(v) => formatMoney(v, currency, 0)} extra={(p) => `${formatNumber(Number(p.count))} bien(s)`} />}
          />
          <Legend verticalAlign="top" align="right" height={28} iconType="square" iconSize={10} formatter={LegendText} />
          <Bar dataKey="gross" name="Valeur brute" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar dataKey="nbv" name="Valeur nette comptable" fill={SERIES[1]} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CapexChart({ data, currency }: { data: { label: string; value: number; count: number }[]; currency: string }) {
  if (!data.some((d) => d.value > 0)) return <EmptyChart text="Aucune acquisition sur les 12 derniers mois." />;
  return (
    <div className="h-64" role="img" aria-label="Acquisitions (CapEx) par mois sur 12 mois">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            dataKey="label"
            {...axisProps}
            interval={0}
            tickMargin={6}
            tickFormatter={(v: string, index: number) => (index === 0 || v.startsWith("janv") ? v : v.split(" ")[0])}
          />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={(v: number) => formatCompactNumber(v)} />
          <Tooltip
            cursor={{ fill: "hsl(220 14% 96%)" }}
            content={<ChartTooltip format={(v) => formatMoney(v, currency, 0)} extra={(p) => `${formatNumber(Number(p.count))} bien(s) acquis`} />}
          />
          <Bar dataKey="value" name="Acquisitions HT" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CampaignProgressChart({
  bySite,
  byFloor,
}: {
  bySite: { name: string; expected: number; found: number; remaining: number }[];
  byFloor: { name: string; expected: number; found: number; remaining: number }[];
}) {
  const [mode, setMode] = useState<"site" | "floor">("site");
  const data = mode === "site" ? bySite : byFloor;
  if (!bySite.length) return <EmptyChart text="Aucune campagne d'inventaire lancée." />;
  const height = Math.max(200, data.length * 40 + 60);
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs" role="tablist" aria-label="Regroupement">
        {(["site", "floor"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn("rounded px-2.5 py-1 font-medium", mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
          >
            {m === "site" ? "Par site" : "Par étage"}
          </button>
        ))}
      </div>
      <div style={{ height }} role="img" aria-label="Avancement du comptage par site ou étage">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis type="category" dataKey="name" width={180} {...axisProps} axisLine={false} />
            <Tooltip
              cursor={{ fill: "hsl(220 14% 96%)" }}
              content={
                <ChartTooltip
                  format={(v) => `${formatNumber(v)} bien(s)`}
                  extra={(p) => `Avancement : ${formatPercent(Number(p.expected) ? Number(p.found) / Number(p.expected) : 0)}`}
                />
              }
            />
            <Legend verticalAlign="top" align="right" height={28} iconType="square" iconSize={10} formatter={LegendText} />
            <Bar dataKey="found" stackId="p" name="Retrouvés" fill={SERIES[0]} stroke={SURFACE} strokeWidth={2} maxBarSize={18} />
            <Bar dataKey="remaining" stackId="p" name="Restant à scanner" fill={NEUTRAL_FILL} stroke={SURFACE} strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function EmptyChart({ text = "Aucune donnée à afficher." }: { text?: string }) {
  return <div className="grid h-48 place-content-center rounded-lg border border-dashed text-sm text-muted-foreground">{text}</div>;
}
