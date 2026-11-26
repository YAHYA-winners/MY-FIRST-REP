/**
 * Formatting helpers (French / Moroccan conventions).
 * Business dates (@db.Date) are stored at UTC midnight and are always formatted
 * in UTC; timestamps are formatted in the company time zone so that server and
 * client renders are identical (no hydration drift).
 */
export const APP_TIMEZONE = "Africa/Casablanca";
const LOCALE = "fr-FR";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number | null | undefined, currency = "MAD", fractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const key = `${currency}:${fractionDigits}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    moneyFormatters.set(key, fmt);
  }
  return fmt.format(value);
}

/** Compact amount for KPI tiles: 1,2 M MAD / 845 k MAD */
export function formatMoneyCompact(value: number, currency = "MAD"): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)} M ${currency}`;
  if (abs >= 10_000) return `${formatNumber(value / 1_000, 0)} k ${currency}`;
  return formatMoney(value, currency, 0);
}

/** Compact axis label without currency: 1,25 M / 850 k / 4 500 */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, abs >= 10_000_000 ? 0 : 1)} M`;
  if (abs >= 10_000) return `${formatNumber(value / 1_000, 0)} k`;
  return formatNumber(value, 0);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${formatNumber(value * 100, fractionDigits)} %`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatMonthLabel(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", month: "short", year: "2-digit" }).format(d);
}

/** ISO date (YYYY-MM-DD) for <input type="date"> values. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// PDF-safe text (jsPDF standard fonts are WinAnsi / CP1252 encoded)
// ---------------------------------------------------------------------------

const CP1252_EXTRAS = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""),
);

const PDF_REPLACEMENTS: Record<string, string> = {
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "≠": "<>",
  "≈": "~",
  "→": "->",
  "←": "<-",
  "✓": "OK",
  "✔": "OK",
  "✗": "X",
  "×": "x",
  "−": "-",
};

/** Replace characters that jsPDF's built-in fonts cannot render. */
export function pdfSafe(text: string | null | undefined): string {
  if (!text) return "";
  let out = "";
  for (const ch of text) {
    const rep = PDF_REPLACEMENTS[ch];
    if (rep !== undefined) {
      out += rep;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0xff || CP1252_EXTRAS.has(ch)) out += ch;
    else out += "?";
  }
  return out;
}

/** Plain number with regular-space thousands separators (PDF / CSV safe). */
export function formatPlainAmount(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [int, dec] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "-" : ""}${grouped}${dec ? `,${dec}` : ""}`;
}
