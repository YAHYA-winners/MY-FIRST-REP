"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  CloudOff,
  CloudUpload,
  Keyboard,
  ListChecks,
  MapPin,
  PackagePlus,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Wrench,
  X,
} from "lucide-react";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { enqueueJob, listJobs, removeJob, updateJob, type FieldJob } from "@/lib/client/offline-queue";
import { feedback, unlockAudio, type FeedbackKind } from "@/lib/client/feedback";
import { compressImage } from "@/lib/client/image";
import { parseScannedCode } from "@/lib/codes";
import { LOCATION_TYPE_LABELS } from "@/lib/constants";
import type { AssetConditionValue, LocationTypeValue } from "@/lib/domain";
import { cn, uniqueId } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotItem {
  a: string; // asset id
  c: string; // code
  d: string; // designation
  s: string | null; // serial
  l: string | null; // expected location
  k: string; // category name
}

interface FieldLocation {
  id: string;
  code: string;
  name: string;
  path: string;
  type: LocationTypeValue;
  inScope: boolean;
}

type CardStatus = "MATCH" | "MISPLACED" | "OUT_OF_SCOPE" | "DISPOSED";

interface ScanCard {
  status: CardStatus;
  code: string;
  rawCode: string;
  assetId: string;
  designation: string;
  serial: string | null;
  expectedPath: string | null;
  manual: boolean;
}

interface RecentEntry {
  id: string;
  code: string;
  label: string;
  status: CardStatus | "SURPLUS";
  sync: "pending" | "synced" | "error";
  message?: string;
  at: number;
}

interface Settings {
  quickMode: boolean;
  sound: boolean;
  gps: boolean;
}

export interface FieldScannerProps {
  campaign: { id: string; code: string; name: string; status: string };
  locations: FieldLocation[];
  categories: { id: string; name: string }[];
  currency: string;
}

const CONDITIONS: { value: AssetConditionValue; label: string; className: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "GOOD", label: "Bon état", className: "bg-emerald-500 text-black", icon: Check },
  { value: "DAMAGED", label: "Endommagé", className: "bg-red-500 text-white", icon: CircleAlert },
  { value: "TO_REPAIR", label: "À réparer", className: "bg-amber-400 text-black", icon: Wrench },
];

const STATUS_STYLE: Record<CardStatus | "UNKNOWN", { band: string; title: string; kind: FeedbackKind }> = {
  MATCH: { band: "bg-emerald-500 text-black", title: "Conforme — bien attendu dans ce local", kind: "success" },
  MISPLACED: { band: "bg-amber-400 text-black", title: "Écart de localisation", kind: "warning" },
  OUT_OF_SCOPE: { band: "bg-amber-400 text-black", title: "Hors périmètre de la campagne", kind: "warning" },
  DISPOSED: { band: "bg-red-500 text-white", title: "Bien sorti de l'actif retrouvé", kind: "error" },
  UNKNOWN: { band: "bg-red-500 text-white", title: "Code inconnu du registre", kind: "error" },
};

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem("immotrack:field-settings");
    if (raw) return { quickMode: false, sound: true, gps: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { quickMode: false, sound: true, gps: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FieldScanner({ campaign, locations, categories, currency }: FieldScannerProps) {
  const [items, setItems] = useState<SnapshotItem[]>([]);
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationId, setLocationId] = useState<string>("");
  const [locationPicker, setLocationPicker] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [cameraOn, setCameraOn] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [card, setCard] = useState<ScanCard | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [surplusOpen, setSurplusOpen] = useState(false);
  const [surplusPrefill, setSurplusPrefill] = useState<string | null>(null);
  const [expectedOpen, setExpectedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({ quickMode: false, sound: true, gps: false });
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [flash, setFlash] = useState<FeedbackKind | null>(null);
  const [tempTagNotice, setTempTagNotice] = useState<string | null>(null);

  const lastDecode = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const processing = useRef(false);
  const position = useRef<GeolocationPosition | null>(null);
  const busy = card !== null || unknownCode !== null || surplusOpen || locationPicker || expectedOpen || settingsOpen;
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const byCode = useMemo(() => new Map(items.map((i) => [i.c.toUpperCase(), i])), [items]);
  const bySerial = useMemo(() => {
    const m = new Map<string, SnapshotItem>();
    for (const i of items) if (i.s) m.set(i.s.toUpperCase(), i);
    return m;
  }, [items]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const currentLocation = locationById.get(locationId) ?? null;
  const expectedHere = useMemo(() => items.filter((i) => i.l === locationId), [items, locationId]);
  const remainingHere = expectedHere.filter((i) => !scanned.has(i.a));
  const foundTotal = useMemo(() => items.filter((i) => scanned.has(i.a)).length, [items, scanned]);

  // ------------------------------------------------------------------ setup
  useEffect(() => {
    setSettings(readSettings());
    try {
      const saved = localStorage.getItem(`immotrack:field-location:${campaign.id}`);
      if (saved) setLocationId(saved);
    } catch {
      /* ignore */
    }
    setOnline(navigator.onLine);
  }, [campaign.id]);

  useEffect(() => {
    try {
      localStorage.setItem("immotrack:field-settings", JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  useEffect(() => {
    if (!locationId) return;
    try {
      localStorage.setItem(`immotrack:field-location:${campaign.id}`, locationId);
    } catch {
      /* ignore */
    }
  }, [locationId, campaign.id]);

  useEffect(() => {
    if (!settings.gps || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => (position.current = p),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [settings.gps]);

  const loadSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/snapshot`, { cache: "no-store" });
      if (res.status === 401) return setSessionExpired(true);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      const body = (await res.json()) as { items: SnapshotItem[]; scanned: string[] };
      setItems(body.items);
      setScanned((prev) => new Set([...prev, ...body.scanned]));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [campaign.id]);

  // ------------------------------------------------------------------ sync
  const refreshPending = useCallback(async () => {
    try {
      setPendingCount((await listJobs(campaign.id)).length);
    } catch {
      /* IndexedDB unavailable */
    }
  }, [campaign.id]);

  const patchRecent = (id: string, patch: Partial<RecentEntry>) => setRecent((r) => r.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const processQueue = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    try {
      const jobs = await listJobs(campaign.id);
      for (const job of jobs) {
        if (job.photo && !job.payload.photoKey) {
          const form = new FormData();
          form.append("file", job.photo, "photo.jpg");
          form.append("kind", job.kind === "surplus" ? "surplus" : "photos");
          const up = await fetch("/api/uploads", { method: "POST", body: form });
          if (up.status === 401) {
            setSessionExpired(true);
            break;
          }
          if (!up.ok) {
            if (up.status >= 500) break;
            job.lastError = "Photo refusée par le serveur";
          } else {
            job.payload.photoKey = ((await up.json()) as { key: string }).key;
          }
          job.photo = null;
          await updateJob(job);
        }
        const url = job.kind === "scan" ? `/api/campaigns/${campaign.id}/scans` : `/api/campaigns/${campaign.id}/surplus`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.payload) });
        if (res.status === 401) {
          setSessionExpired(true);
          break;
        }
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          await removeJob(job.id);
          if (job.kind === "scan" || body.kind === "scan") {
            const assetId = (body.asset?.id ?? body.scan?.asset?.id) as string | undefined;
            if (assetId) setScanned((s) => new Set(s).add(assetId));
            patchRecent(job.id, { sync: "synced" });
          } else {
            patchRecent(job.id, { sync: "synced", message: `Étiquette provisoire ${body.tempTag}` });
            setTempTagNotice(body.tempTag ?? null);
          }
        } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          await removeJob(job.id);
          patchRecent(job.id, { sync: "error", message: String(body.error ?? `Refusé (HTTP ${res.status})`).replace("UNKNOWN_CODE:", "").trim() });
        } else {
          job.attempts += 1;
          job.lastError = body.error ?? `HTTP ${res.status}`;
          await updateJob(job);
          break;
        }
      }
    } catch {
      /* offline: retried on reconnect / timer */
    } finally {
      processing.current = false;
      void refreshPending();
    }
  }, [campaign.id, refreshPending]);

  useEffect(() => {
    void loadSnapshot();
    void refreshPending().then(() => processQueue());
    const onOnline = () => {
      setOnline(true);
      void processQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = setInterval(() => {
      void processQueue();
      if (navigator.onLine) void loadSnapshot();
    }, 45_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [loadSnapshot, processQueue, refreshPending]);

  // ------------------------------------------------------------------ feedback
  const signal = useCallback(
    (kind: FeedbackKind) => {
      feedback(kind, { sound: settings.sound });
      setFlash(kind);
      setTimeout(() => setFlash(null), 380);
    },
    [settings.sound],
  );

  const gps = () => {
    const p = position.current;
    if (!settings.gps || !p) return {};
    return { latitude: p.coords.latitude, longitude: p.coords.longitude, gpsAccuracy: Math.round(p.coords.accuracy) };
  };

  // ------------------------------------------------------------------ submit
  const submitScan = async (c: ScanCard, condition: AssetConditionValue, transferProposed: boolean, notes: string, photo: Blob | null) => {
    const id = uniqueId();
    const job: FieldJob = {
      id,
      kind: "scan",
      campaignId: campaign.id,
      label: `${c.code} — ${c.designation}`,
      createdAt: Date.now(),
      attempts: 0,
      photo,
      payload: {
        clientId: id,
        code: c.rawCode,
        locationId,
        condition,
        transferProposed,
        manualEntry: c.manual,
        notes: notes || null,
        scannedAt: new Date().toISOString(),
        deviceInfo: navigator.userAgent.slice(0, 280),
        ...gps(),
      },
    };
    setRecent((r) => [{ id, code: c.code, label: c.designation, status: c.status, sync: "pending" as const, at: Date.now() }, ...r].slice(0, 30));
    setScanned((s) => new Set(s).add(c.assetId));
    setCard(null);
    try {
      await enqueueJob(job);
    } catch {
      patchRecent(id, { sync: "error", message: "Stockage local indisponible" });
      return;
    }
    void refreshPending();
    void processQueue();
  };

  const submitSurplus = async (data: SurplusFormData) => {
    const id = uniqueId();
    const job: FieldJob = {
      id,
      kind: "surplus",
      campaignId: campaign.id,
      label: data.designation,
      createdAt: Date.now(),
      attempts: 0,
      photo: data.photo,
      payload: {
        clientId: id,
        scannedCode: data.scannedCode,
        designation: data.designation,
        brand: data.brand || null,
        model: data.model || null,
        serialNumber: data.serialNumber || null,
        categoryId: data.categoryId || null,
        estimatedValue: data.estimatedValue === "" ? null : Number(data.estimatedValue),
        condition: data.condition,
        notes: data.notes || null,
        locationId,
        foundAt: new Date().toISOString(),
        ...gps(),
      },
    };
    setRecent((r) => [{ id, code: data.scannedCode ?? "TMP-…", label: data.designation, status: "SURPLUS" as const, sync: "pending" as const, at: Date.now() }, ...r].slice(0, 30));
    setSurplusOpen(false);
    setSurplusPrefill(null);
    signal("info");
    await enqueueJob(job);
    void refreshPending();
    void processQueue();
  };

  // ------------------------------------------------------------------ decode
  const openCardFor = useCallback(
    (item: SnapshotItem, rawCode: string, manual: boolean) => {
      const status: CardStatus = item.l === locationId ? "MATCH" : "MISPLACED";
      const next: ScanCard = {
        status,
        code: item.c,
        rawCode,
        assetId: item.a,
        designation: item.d,
        serial: item.s,
        expectedPath: item.l ? locationById.get(item.l)?.path ?? "Localisation hors liste" : "Non localisé dans le fichier comptable",
        manual,
      };
      signal(STATUS_STYLE[status].kind);
      if (settings.quickMode && status === "MATCH" && !manual) {
        void submitScan(next, "GOOD", false, "", null);
        return;
      }
      setCard(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationId, locationById, settings.quickMode, signal],
  );

  /** `typed`: keyboard / hand-held scanner input (label read, but no camera debounce). */
  const handleCode = useCallback(
    async (text: string, typed = false) => {
      const now = Date.now();
      if (!typed && text === lastDecode.current.text && now - lastDecode.current.at < 2500) return;
      lastDecode.current = { text, at: now };
      if (!typed && busyRef.current) return;
      const parsed = parseScannedCode(text);
      if (!parsed.raw) return;

      if (parsed.kind === "location") {
        const loc = locations.find((l) => l.code.toUpperCase() === parsed.code.toUpperCase());
        if (loc) {
          setLocationId(loc.id);
          signal("info");
        } else signal("error");
        return;
      }
      if (!locationId) {
        signal("error");
        setLocationPicker(true);
        return;
      }
      const key = (parsed.kind === "asset" ? parsed.code : parsed.value).toUpperCase();
      const item = byCode.get(key) ?? (parsed.kind === "raw" ? bySerial.get(key) : undefined);
      if (item) return openCardFor(item, parsed.raw, false);

      if (navigator.onLine) {
        try {
          const res = await fetch(`/api/campaigns/${campaign.id}/lookup?code=${encodeURIComponent(parsed.raw)}`);
          if (res.status === 401) return setSessionExpired(true);
          const body = await res.json();
          if (body.found) {
            const status: CardStatus = body.asset.status === "DISPOSED" ? "DISPOSED" : "OUT_OF_SCOPE";
            signal(STATUS_STYLE[status].kind);
            setCard({
              status,
              code: body.asset.code,
              rawCode: parsed.raw,
              assetId: body.asset.id,
              designation: body.asset.designation,
              serial: body.asset.serialNumber,
              expectedPath: body.asset.locationPath,
              manual: false,
            });
            return;
          }
        } catch {
          /* treat as unknown */
        }
      }
      signal("error");
      setUnknownCode(parsed.raw);
    },
    [byCode, bySerial, campaign.id, locationId, locations, openCardFor, signal],
  );

  // ------------------------------------------------------------------ render
  const filteredLocations = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    return locations
      .filter((l) => !q || l.path.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
      .sort((a, b) => Number(b.inScope) - Number(a.inScope) || a.path.localeCompare(b.path, "fr", { numeric: true }));
  }, [locations, locationQuery]);

  if (campaign.status !== "IN_PROGRESS") {
    return (
      <div className="grid min-h-dvh place-content-center gap-4 bg-slate-950 p-6 text-center text-white">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-400" />
        <p className="text-lg font-semibold">Le comptage de la campagne {campaign.code} n&apos;est pas ouvert.</p>
        <Link href={`/campaigns/${campaign.id}`} className="text-sky-300 underline">
          Retour à la campagne
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-white" onPointerDown={unlockAudio}>
      {flash && (
        <div
          className={cn(
            "pointer-events-none fixed inset-0 z-[60] animate-flash-in opacity-40",
            flash === "success" && "bg-emerald-400",
            flash === "warning" && "bg-amber-400",
            flash === "error" && "bg-red-500",
            flash === "info" && "bg-sky-400",
          )}
        />
      )}

      <header className="safe-top sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 px-3 pb-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href={`/campaigns/${campaign.id}`} className="grid h-11 w-11 place-content-center rounded-full hover:bg-white/10" aria-label="Quitter le mode terrain">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{campaign.name}</p>
            <p className="font-mono text-xs text-slate-400">
              {campaign.code} · {foundTotal}/{items.length} retrouvés
            </p>
          </div>
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
              !online ? "bg-red-500/20 text-red-300" : pendingCount ? "bg-amber-400/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300",
            )}
          >
            {!online ? <CloudOff className="h-3.5 w-3.5" /> : pendingCount ? <CloudUpload className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {!online ? `Hors ligne${pendingCount ? ` · ${pendingCount}` : ""}` : pendingCount ? `${pendingCount} à synchroniser` : "Synchronisé"}
          </span>
          <button className="grid h-11 w-11 place-content-center rounded-full hover:bg-white/10" onClick={() => setSettingsOpen(true)} aria-label="Réglages">
            <Settings2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-3 px-3 pb-40 pt-3">
        {sessionExpired && (
          <div className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">
            Session expirée : vos scans sont conservés sur l&apos;appareil.{" "}
            <a href={`/login?next=/campaigns/${campaign.id}/scan`} className="font-semibold underline">
              Se reconnecter
            </a>
          </div>
        )}
        {loadError && (
          <div className="flex items-center justify-between rounded-xl bg-amber-400/15 p-3 text-sm text-amber-200">
            Fichier théorique non chargé ({loadError}).
            <button onClick={() => loadSnapshot()} className="flex items-center gap-1 font-semibold underline">
              <RefreshCw className="h-4 w-4" /> Réessayer
            </button>
          </div>
        )}

        <button
          onClick={() => setLocationPicker(true)}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left",
            currentLocation ? "border-sky-400/60 bg-sky-500/10" : "animate-pulse border-amber-400 bg-amber-400/10",
          )}
        >
          <MapPin className={cn("h-7 w-7 shrink-0", currentLocation ? "text-sky-300" : "text-amber-300")} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Local en cours d&apos;inventaire</span>
            <span className="block truncate text-lg font-bold">{currentLocation ? currentLocation.name : "Sélectionnez le local"}</span>
            {currentLocation && <span className="block truncate text-xs text-slate-400">{currentLocation.path}</span>}
          </span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>

        {currentLocation && (
          <button onClick={() => setExpectedOpen(true)} className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-left">
            <ListChecks className="h-5 w-5 text-sky-300" />
            <span className="flex-1 text-sm">
              <strong className="text-base">{expectedHere.length - remainingHere.length}</strong> / {expectedHere.length} biens attendus scannés dans ce local
            </span>
            {remainingHere.length > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-black">{remainingHere.length} restants</span>}
          </button>
        )}

        <QrScanner active={cameraOn && !busy && !!currentLocation && !loading} onDecode={(t) => void handleCode(t)} />

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manualCode.trim()) void handleCode(manualCode.trim(), true);
            setManualCode("");
          }}
        >
          <div className="relative flex-1">
            <Keyboard className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Code, n° de série ou douchette…"
              className="h-14 w-full rounded-xl border-2 border-white/15 bg-white/5 pl-11 pr-3 text-base text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
              autoCapitalize="characters"
              autoCorrect="off"
              enterKeyHint="go"
            />
          </div>
          <button type="submit" className="h-14 rounded-xl bg-sky-500 px-5 text-base font-bold text-black active:scale-95">
            OK
          </button>
        </form>

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Derniers constats</h2>
          {recent.length === 0 && <p className="px-1 text-sm text-slate-500">Aucun scan dans cette session.</p>}
          {recent.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
              <span
                className={cn(
                  "h-9 w-1.5 shrink-0 rounded-full",
                  r.status === "MATCH" && "bg-emerald-400",
                  (r.status === "MISPLACED" || r.status === "OUT_OF_SCOPE") && "bg-amber-400",
                  r.status === "DISPOSED" && "bg-red-500",
                  r.status === "SURPLUS" && "bg-sky-400",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-semibold">{r.code}</p>
                <p className="truncate text-xs text-slate-400">{r.message ?? r.label}</p>
              </div>
              <span className="text-xs">
                {r.sync === "pending" && <CloudUpload className="h-4 w-4 text-amber-300" />}
                {r.sync === "synced" && <Check className="h-4 w-4 text-emerald-400" />}
                {r.sync === "error" && <X className="h-4 w-4 text-red-400" />}
              </span>
            </div>
          ))}
        </section>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/95 px-3 pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-[auto_1fr] gap-3">
          <button
            onClick={() => setCameraOn((v) => !v)}
            className="grid h-16 w-16 place-content-center rounded-2xl bg-white/10 active:scale-95"
            aria-label={cameraOn ? "Mettre la caméra en pause" : "Activer la caméra"}
          >
            {cameraOn ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </button>
          <button
            onClick={() => {
              if (!locationId) return setLocationPicker(true);
              setSurplusPrefill(null);
              setSurplusOpen(true);
            }}
            className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-sky-500 text-base font-bold text-black active:scale-[0.98]"
          >
            <PackagePlus className="h-6 w-6" /> Bien non étiqueté / excédent
          </button>
        </div>
      </nav>

      {/* ---------------------------------------------------------------- result card */}
      {card && (
        <ResultSheet
          card={card}
          currentLocationName={currentLocation?.name ?? ""}
          onCancel={() => setCard(null)}
          onSubmit={(condition, transfer, notes, photo) => void submitScan(card, condition, transfer, notes, photo)}
        />
      )}

      {unknownCode && (
        <BottomSheet onClose={() => setUnknownCode(null)}>
          <div className={cn("-mx-5 -mt-5 mb-4 rounded-t-3xl px-5 py-4", STATUS_STYLE.UNKNOWN.band)}>
            <p className="text-sm font-bold uppercase tracking-wide">{STATUS_STYLE.UNKNOWN.title}</p>
            <p className="mt-1 break-all font-mono text-lg font-bold">{unknownCode}</p>
          </div>
          <p className="text-sm text-slate-300">
            Ce code ne correspond à aucun bien du registre{!online && " (vérification impossible hors ligne)"}. Enregistrez-le comme excédent d&apos;inventaire
            avec une photo : il sera rapproché par la comptabilité.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button onClick={() => setUnknownCode(null)} className="h-14 rounded-xl bg-white/10 font-semibold">
              Ignorer
            </button>
            <button
              onClick={() => {
                setSurplusPrefill(unknownCode);
                setUnknownCode(null);
                setSurplusOpen(true);
              }}
              className="h-14 rounded-xl bg-sky-500 font-bold text-black"
            >
              Saisir l&apos;excédent
            </button>
          </div>
        </BottomSheet>
      )}

      {surplusOpen && (
        <SurplusSheet
          scannedCode={surplusPrefill}
          categories={categories}
          currency={currency}
          locationName={currentLocation?.name ?? ""}
          onClose={() => {
            setSurplusOpen(false);
            setSurplusPrefill(null);
          }}
          onSubmit={(d) => void submitSurplus(d)}
        />
      )}

      {tempTagNotice && (
        <BottomSheet onClose={() => setTempTagNotice(null)}>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-300">Étiquette provisoire attribuée</p>
          <p className="my-4 text-center font-mono text-4xl font-black tracking-wider">{tempTagNotice}</p>
          <p className="text-sm text-slate-300">Inscrivez ce code sur le bien (étiquette provisoire) : il servira au rapprochement comptable.</p>
          <button onClick={() => setTempTagNotice(null)} className="mt-5 h-14 w-full rounded-xl bg-sky-500 font-bold text-black">
            C&apos;est noté
          </button>
        </BottomSheet>
      )}

      {/* ---------------------------------------------------------------- location picker */}
      {locationPicker && (
        <BottomSheet onClose={() => setLocationPicker(false)} tall>
          <p className="mb-3 text-lg font-bold">Choisir le local</p>
          <p className="mb-3 text-xs text-slate-400">Astuce : scannez directement le QR code affiché à l&apos;entrée du local.</p>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Rechercher un bureau, un étage…"
              className="h-12 w-full rounded-xl border-2 border-white/15 bg-white/5 pl-11 pr-3 text-base text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <ul className="max-h-[55dvh] space-y-1.5 overflow-y-auto">
            {filteredLocations.map((l) => {
              const expected = items.filter((i) => i.l === l.id);
              const done = expected.filter((i) => scanned.has(i.a)).length;
              return (
                <li key={l.id}>
                  <button
                    onClick={() => {
                      setLocationId(l.id);
                      setLocationPicker(false);
                      setLocationQuery("");
                      signal("info");
                    }}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left", l.id === locationId ? "bg-sky-500/20" : "bg-white/5")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{l.name}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {LOCATION_TYPE_LABELS[l.type]} · {l.path}
                      </span>
                    </span>
                    {expected.length > 0 && (
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", done === expected.length ? "bg-emerald-500 text-black" : "bg-white/10")}>
                        {done}/{expected.length}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </BottomSheet>
      )}

      {/* ---------------------------------------------------------------- expected list */}
      {expectedOpen && (
        <BottomSheet onClose={() => setExpectedOpen(false)} tall>
          <p className="text-lg font-bold">Biens attendus · {currentLocation?.name}</p>
          <p className="mb-3 text-xs text-slate-400">Touchez un bien dont l&apos;étiquette est illisible pour constater sa présence manuellement.</p>
          <ul className="max-h-[60dvh] space-y-1.5 overflow-y-auto">
            {expectedHere.map((i) => {
              const done = scanned.has(i.a);
              return (
                <li key={i.a}>
                  <button
                    disabled={done}
                    onClick={() => {
                      setExpectedOpen(false);
                      openCardFor(i, i.c, true);
                    }}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left", done ? "bg-emerald-500/10 opacity-70" : "bg-white/5")}
                  >
                    {done ? <Check className="h-5 w-5 shrink-0 text-emerald-400" /> : <Camera className="h-5 w-5 shrink-0 text-amber-300" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-semibold">{i.c}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {i.d}
                        {i.s && ` · S/N ${i.s}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {expectedHere.length === 0 && <li className="py-6 text-center text-sm text-slate-500">Aucun bien attendu dans ce local.</li>}
          </ul>
        </BottomSheet>
      )}

      {settingsOpen && (
        <BottomSheet onClose={() => setSettingsOpen(false)}>
          <p className="mb-4 text-lg font-bold">Réglages du mode terrain</p>
          {(
            [
              ["quickMode", "Validation rapide", "Un bien conforme et en bon état est enregistré dès le scan, sans confirmation."],
              ["sound", "Signal sonore", "Bip distinct selon le résultat (conforme, écart, inconnu)."],
              ["gps", "Géolocalisation des scans", "Horodatage GPS de chaque constat (autorisation requise)."],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-3 border-b border-white/10 py-3">
              <input
                type="checkbox"
                className="mt-1 h-6 w-6 accent-sky-500"
                checked={settings[key]}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-xs text-slate-400">{hint}</span>
              </span>
            </label>
          ))}
          <button
            onClick={() => {
              void processQueue();
              void loadSnapshot();
              setSettingsOpen(false);
            }}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/10 font-semibold"
          >
            <RefreshCw className="h-4 w-4" /> Forcer la synchronisation
          </button>
        </BottomSheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BottomSheet({ children, onClose, tall }: { children: React.ReactNode; onClose: () => void; tall?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={onClose}>
      <div
        className={cn("safe-bottom w-full animate-slide-up rounded-t-3xl border-t border-white/10 bg-slate-900 p-5 text-white", tall && "max-h-[90dvh]")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto max-w-xl">{children}</div>
      </div>
    </div>
  );
}

function PhotoInput({ photo, onChange, required }: { photo: Blob | null; onChange: (b: Blob | null) => void; required: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3", required && !photo ? "border-amber-400 bg-amber-400/10" : "border-white/20")}>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Photo du bien" className="h-16 w-16 rounded-lg object-cover" />
      ) : (
        <span className="grid h-16 w-16 place-content-center rounded-lg bg-white/10">
          <Camera className="h-7 w-7" />
        </span>
      )}
      <span className="flex-1 text-sm">
        <span className="block font-semibold">{photo ? "Photo jointe — reprendre" : "Prendre une photo"}</span>
        <span className="block text-xs text-slate-400">{required ? "Obligatoire comme preuve" : "Facultative"}</span>
      </span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onChange(await compressImage(f));
          e.target.value = "";
        }}
      />
    </label>
  );
}

function ResultSheet({
  card,
  currentLocationName,
  onCancel,
  onSubmit,
}: {
  card: ScanCard;
  currentLocationName: string;
  onCancel: () => void;
  onSubmit: (condition: AssetConditionValue, transfer: boolean, notes: string, photo: Blob | null) => void;
}) {
  const [condition, setCondition] = useState<AssetConditionValue>("GOOD");
  const [transfer, setTransfer] = useState(true);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const style = STATUS_STYLE[card.status];
  const photoRequired = condition !== "GOOD";
  const misplaced = card.status === "MISPLACED" || card.status === "OUT_OF_SCOPE";

  return (
    <BottomSheet onClose={onCancel} tall>
      <div className={cn("-mx-5 -mt-5 mb-4 rounded-t-3xl px-5 py-4", style.band)}>
        <p className="text-xs font-bold uppercase tracking-wide">{style.title}</p>
        <p className="mt-1 font-mono text-2xl font-black">{card.code}</p>
        <p className="truncate text-sm font-semibold">{card.designation}</p>
      </div>
      <div className="max-h-[62dvh] space-y-4 overflow-y-auto pb-1">
        {card.serial && <p className="font-mono text-sm text-slate-300">S/N {card.serial}</p>}
        {card.manual && <p className="rounded-lg bg-white/5 p-2 text-xs text-slate-300">Constat manuel (étiquette illisible ou absente).</p>}
        {misplaced && (
          <div className="rounded-xl bg-amber-400/15 p-3 text-sm">
            <p className="text-amber-200">
              Localisation comptable : <strong>{card.expectedPath ?? "non renseignée"}</strong>
            </p>
            <label className="mt-2 flex items-center gap-3">
              <input type="checkbox" className="h-6 w-6 accent-amber-400" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} />
              <span className="font-semibold">Proposer le transfert vers « {currentLocationName} »</span>
            </label>
          </div>
        )}
        {card.status === "DISPOSED" && (
          <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">Ce bien est sorti de l&apos;actif dans le registre : le constat sera signalé en écart positif.</p>
        )}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">État physique constaté</p>
          <div className="grid grid-cols-3 gap-2">
            {CONDITIONS.map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.value}
                  onClick={() => setCondition(c.value)}
                  className={cn(
                    "flex h-20 flex-col items-center justify-center gap-1 rounded-xl text-sm font-bold transition-transform active:scale-95",
                    condition === c.value ? `${c.className} ring-4 ring-white` : "bg-white/10 text-white",
                  )}
                >
                  <Icon className="h-6 w-6" />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
        <PhotoInput photo={photo} onChange={setPhoto} required={photoRequired} />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observation (facultatif)"
          rows={2}
          className="w-full rounded-xl border-2 border-white/15 bg-white/5 p-3 text-base text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
        />
      </div>
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-3">
        <button onClick={onCancel} className="h-16 rounded-xl bg-white/10 text-base font-semibold">
          Annuler
        </button>
        <button
          onClick={() => onSubmit(condition, misplaced && transfer, notes, photo)}
          disabled={photoRequired && !photo}
          className="h-16 rounded-xl bg-emerald-500 text-lg font-black text-black active:scale-[0.98] disabled:opacity-40"
        >
          Valider le constat
        </button>
      </div>
    </BottomSheet>
  );
}

interface SurplusFormData {
  scannedCode: string | null;
  designation: string;
  categoryId: string;
  brand: string;
  model: string;
  serialNumber: string;
  estimatedValue: string;
  condition: AssetConditionValue;
  notes: string;
  photo: Blob | null;
}

function SurplusSheet({
  scannedCode,
  categories,
  currency,
  locationName,
  onClose,
  onSubmit,
}: {
  scannedCode: string | null;
  categories: { id: string; name: string }[];
  currency: string;
  locationName: string;
  onClose: () => void;
  onSubmit: (d: SurplusFormData) => void;
}) {
  const [d, setD] = useState<SurplusFormData>({
    scannedCode,
    designation: "",
    categoryId: "",
    brand: "",
    model: "",
    serialNumber: "",
    estimatedValue: "",
    condition: "GOOD",
    notes: "",
    photo: null,
  });
  const input = "h-12 w-full rounded-xl border-2 border-white/15 bg-white/5 px-3 text-base text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none";
  return (
    <BottomSheet onClose={onClose} tall>
      <p className="text-lg font-bold">Excédent / bien non étiqueté</p>
      <p className="mb-3 text-xs text-slate-400">
        Local : {locationName}
        {scannedCode && ` · code lu : ${scannedCode}`}
      </p>
      <div className="max-h-[64dvh] space-y-3 overflow-y-auto pb-1">
        <PhotoInput photo={d.photo} onChange={(photo) => setD((prev) => ({ ...prev, photo }))} required />
        <input className={input} placeholder="Désignation * (ex. Fauteuil de direction)" value={d.designation} onChange={(e) => setD((prev) => ({ ...prev, designation: e.target.value }))} />
        <select className={input} value={d.categoryId} onChange={(e) => setD((prev) => ({ ...prev, categoryId: e.target.value }))}>
          <option value="">Catégorie (si connue)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Marque" value={d.brand} onChange={(e) => setD((prev) => ({ ...prev, brand: e.target.value }))} />
          <input className={input} placeholder="Modèle" value={d.model} onChange={(e) => setD((prev) => ({ ...prev, model: e.target.value }))} />
        </div>
        <input className={input} placeholder="N° de série" value={d.serialNumber} onChange={(e) => setD((prev) => ({ ...prev, serialNumber: e.target.value }))} autoCapitalize="characters" />
        <input
          className={input}
          placeholder={`Valeur estimée (${currency})`}
          inputMode="decimal"
          value={d.estimatedValue}
          onChange={(e) => setD((prev) => ({ ...prev, estimatedValue: e.target.value.replace(",", ".").replace(/[^\d.]/g, "") }))}
        />
        <div className="grid grid-cols-3 gap-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setD((prev) => ({ ...prev, condition: c.value }))}
              className={cn("h-14 rounded-xl text-sm font-bold", d.condition === c.value ? `${c.className} ring-4 ring-white` : "bg-white/10")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <textarea
          rows={2}
          className="w-full rounded-xl border-2 border-white/15 bg-white/5 p-3 text-base text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          placeholder="Observation (propriétaire supposé, bien loué…)"
          value={d.notes}
          onChange={(e) => setD((prev) => ({ ...prev, notes: e.target.value }))}
        />
      </div>
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-3">
        <button onClick={onClose} className="h-16 rounded-xl bg-white/10 font-semibold">
          Annuler
        </button>
        <button
          disabled={!d.designation.trim() || !d.photo}
          onClick={() => onSubmit(d)}
          className="h-16 rounded-xl bg-sky-500 text-lg font-black text-black disabled:opacity-40"
        >
          Enregistrer l&apos;excédent
        </button>
      </div>
    </BottomSheet>
  );
}
