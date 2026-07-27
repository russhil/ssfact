/**
 * Change 25 Part C — CSV, in one place.
 *
 * The quoting rules were written once for the Change 21 finished-goods route and are
 * lifted here verbatim so the toolbar export and the ERP bridge cannot drift apart.
 * Deliberately dependency-free: this runs both on the server (route handlers) and in
 * the browser (the toolbar's Blob download).
 */

/** Quote only when needed; double an embedded quote, per RFC 4180. */
export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: (string | number)[]) => cells.map(csvCell).join(",");

export const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
};

/** A null/undefined cell is an empty field, never the literal "null". */
function cell(v: string | number | Date | null | undefined): string | number {
  if (v == null) return "";
  if (v instanceof Date) return ymd(v);
  return v;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = csvLine(columns.map((c) => c.header));
  const body = rows.map((r) => csvLine(columns.map((c) => cell(c.value(r)))));
  // CRLF + trailing newline: what Excel expects when a file is opened directly.
  return [head, ...body].join("\r\n") + "\r\n";
}

/** Browser-side download of a string as a file. No-op on the server. */
export function downloadCsv(filename: string, body: string) {
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
