import * as XLSX from "xlsx";

export type CellValue = string | number | boolean | Date | null | undefined;

export interface SheetSpec {
  name: string;
  title?: string[];
  header: string[];
  rows: CellValue[][];
  widths?: number[];
  /** Column indexes formatted as amounts (# ##0,00). */
  moneyCols?: number[];
  /** Column indexes formatted as integers. */
  intCols?: number[];
  /** Column indexes formatted as percentages (value in 0..1). */
  percentCols?: number[];
  /** Column indexes holding ISO dates (YYYY-MM-DD) to convert to Excel dates. */
  dateCols?: number[];
  totalsRow?: CellValue[];
}

const MONEY_FMT = "#,##0.00";
const INT_FMT = "#,##0";
const PCT_FMT = "0.0%";
const DATE_FMT = "dd/mm/yyyy";

function toCell(value: CellValue, isDate: boolean): CellValue {
  if (isDate && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return value ?? "";
}

/** Builds a worksheet with title block, header, typed columns, autofilter and widths. */
export function buildSheet(spec: SheetSpec): XLSX.WorkSheet {
  const titleRows = (spec.title ?? []).map((t) => [t]);
  const offset = titleRows.length ? titleRows.length + 1 : 0;
  const dateCols = new Set(spec.dateCols ?? []);
  const body = spec.rows.map((r) => r.map((v, i) => toCell(v, dateCols.has(i))));
  const aoa: CellValue[][] = [...titleRows, ...(titleRows.length ? [[]] : []), spec.header, ...body];
  if (spec.totalsRow) aoa.push(spec.totalsRow);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  const firstDataRow = offset + 1;
  const lastRow = aoa.length - 1;
  const apply = (cols: number[] | undefined, fmt: string) => {
    for (const c of cols ?? []) {
      for (let r = firstDataRow; r <= lastRow; r++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref];
        if (cell && cell.t === "n") cell.z = fmt;
        if (cell && cell.t === "d") cell.z = DATE_FMT;
      }
    }
  };
  apply(spec.moneyCols, MONEY_FMT);
  apply(spec.intCols, INT_FMT);
  apply(spec.percentCols, PCT_FMT);
  apply(spec.dateCols, DATE_FMT);

  ws["!cols"] = (spec.widths ?? spec.header.map(() => 16)).map((wch) => ({ wch }));
  if (spec.rows.length) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: offset, c: 0 }, e: { r: offset + spec.rows.length, c: spec.header.length - 1 } }),
    };
  }
  if (titleRows.length) {
    ws["!merges"] = titleRows.map((_, r) => ({ s: { r, c: 0 }, e: { r, c: Math.min(spec.header.length - 1, 8) } }));
  }
  return ws;
}

export function writeWorkbook(sheets: SheetSpec[], fileName: string, props?: { Title?: string; Company?: string; Author?: string }) {
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: props?.Title, Company: props?.Company, Author: props?.Author ?? "ImmoTrack", CreatedDate: new Date() };
  for (const spec of sheets) {
    XLSX.utils.book_append_sheet(wb, buildSheet(spec), spec.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName, { compression: true });
}

export function safeFileName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
