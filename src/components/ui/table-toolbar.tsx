"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { toCsv, downloadCsv, ymd, type CsvColumn } from "@/lib/csv";
import { SearchInput, inputClass } from "./form";
import { BottomSheet } from "./sheet";

/**
 * Change 23 Part A — one table toolbar, reused by every list screen.
 *
 * Change 22 fixed what you can DO to a row; this fixes FINDING the row. Coverage
 * used to track how each table happened to be built rather than how busy it is:
 * the client-component tables got basic filtering, the highest-volume
 * server-rendered logs (challans, orders, dispatch, inventory) got nothing, and
 * nothing anywhere had click-to-sort or a date range.
 *
 * Built once so every screen behaves the same, bugs have one home, and sort +
 * date-range come free to tables that never asked for them.
 *
 * Everything is client-side over rows the server already fetched — no new
 * queries, no server-action changes, no change to how a row is created or
 * reversed.
 */

export type FilterDef<T> = {
  key: string;
  label: string;
  /** "All" is prepended automatically, so give a lowercase plural: "suppliers". */
  options: { value: string; label: string }[];
  /** Return true to keep the row for this filter value. */
  match: (row: T, value: string) => boolean;
  /** Pre-selected value on first load (e.g. challans hide Void by default). */
  initial?: string;
};

export type SortDef<T> = Record<string, (row: T) => string | number | Date | null | undefined>;

type Dir = "asc" | "desc";

export type TableViewOptions<T> = {
  /** Short, unique per page — namespaces the URL params and the stored view. */
  id: string;
  rows: T[];
  /** Free-text haystack for a row; matched case-insensitively. */
  search?: (row: T) => (string | null | undefined)[];
  filters?: FilterDef<T>[];
  /** The date field the from/to range applies to. */
  date?: (row: T) => Date | string | null | undefined;
  sorts?: SortDef<T>;
  defaultSort?: { key: string; dir: Dir };
  /** Adds a total to the result summary, e.g. "12 rows · 3,801 pcs". */
  sum?: (row: T) => number;
  sumLabel?: string;
  /** Reflect the view into the URL and remember it per table. Default true. */
  persist?: boolean;
};

const STORE_PREFIX = "sportsun.table.";
/** Local midnight-to-midnight, so a date range is inclusive of both ends. */
const dayStart = (s: string) => new Date(`${s}T00:00:00`);
const dayEnd = (s: string) => new Date(`${s}T23:59:59.999`);

export function useTableView<T>(opts: TableViewOptions<T>) {
  const { id, rows, search, filters, date, sorts, defaultSort, sum, persist = true } = opts;
  const router = useRouter();
  const params = useSearchParams();
  const p = useCallback((k: string) => `${id}_${k}`, [id]);

  // Read the URL first: a shared link must win over whatever this browser
  // happened to look at last.
  const [q, setQ] = useState(() => params.get(p("q")) ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of filters ?? []) init[f.key] = params.get(p(f.key)) ?? f.initial ?? "";
    return init;
  });
  const [from, setFrom] = useState(() => params.get(p("from")) ?? "");
  const [to, setTo] = useState(() => params.get(p("to")) ?? "");
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(() => {
    const s = params.get(p("sort"));
    if (s) {
      const [key, dir] = s.split(":");
      if (sorts?.[key]) return { key, dir: dir === "asc" ? "asc" : "desc" };
    }
    return defaultSort ?? null;
  });

  // Restore the remembered view only when the URL carried nothing — reading
  // localStorage during render would break hydration (the server has no idea what
  // this browser last looked at), so it has to land after mount. That means one
  // deliberate setState-in-effect, which the lint rule below flags by default;
  // it runs exactly once per table and React batches the setters into a single
  // re-render.
  const restored = useRef(false);
  useEffect(() => {
    if (!persist || restored.current) return;
    restored.current = true;
    if ([...params.keys()].some((k) => k.startsWith(`${id}_`))) return;
    try {
      const raw = window.localStorage.getItem(STORE_PREFIX + id);
      if (!raw) return;
      const v = JSON.parse(raw) as { q?: string; values?: Record<string, string>; from?: string; to?: string; sort?: { key: string; dir: Dir } | null };
      /* eslint-disable react-hooks/set-state-in-effect */
      if (v.q) setQ(v.q);
      if (v.values) setValues((cur) => ({ ...cur, ...v.values }));
      if (v.from) setFrom(v.from);
      if (v.to) setTo(v.to);
      if (v.sort && sorts?.[v.sort.key]) setSort(v.sort);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* a corrupt stored view is not worth breaking the page over */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, persist]);

  // Push the view into the URL (shareable, survives refresh) and remember it.
  useEffect(() => {
    if (!persist || !restored.current) return;
    const next = new URLSearchParams(window.location.search);
    const set = (k: string, v: string) => (v ? next.set(p(k), v) : next.delete(p(k)));
    set("q", q);
    set("from", from);
    set("to", to);
    for (const f of filters ?? []) set(f.key, values[f.key] === (f.initial ?? "") ? "" : values[f.key] ?? "");
    set("sort", sort ? `${sort.key}:${sort.dir}` : "");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    try {
      window.localStorage.setItem(STORE_PREFIX + id, JSON.stringify({ q, values, from, to, sort }));
    } catch {
      /* private mode / quota — the view just won't be remembered */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, values, from, to, sort, persist]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = from ? dayStart(from) : null;
    const hi = to ? dayEnd(to) : null;

    let out = rows.filter((r) => {
      for (const f of filters ?? []) {
        const v = values[f.key];
        if (v && !f.match(r, v)) return false;
      }
      if ((lo || hi) && date) {
        const d = date(r);
        if (!d) return false;
        const t = d instanceof Date ? d : new Date(d);
        if (lo && t < lo) return false;
        if (hi && t > hi) return false;
      }
      if (!needle) return true;
      return (search?.(r) ?? []).some((s) => s && s.toLowerCase().includes(needle));
    });

    if (sort && sorts?.[sort.key]) {
      const get = sorts[sort.key];
      const sign = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = get(a), y = get(b);
        // blanks always sink, whichever way the column is pointing
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const xa = x instanceof Date ? x.getTime() : x;
        const ya = y instanceof Date ? y.getTime() : y;
        if (typeof xa === "number" && typeof ya === "number") return (xa - ya) * sign;
        return String(xa).localeCompare(String(ya)) * sign;
      });
    }
    return out;
  }, [rows, q, values, from, to, sort, filters, search, sorts, date]);

  const total = useMemo(() => (sum ? shown.reduce((a, r) => a + sum(r), 0) : null), [shown, sum]);

  const toggleSort = useCallback(
    (key: string) =>
      setSort((cur) => {
        if (cur?.key !== key) return { key, dir: "asc" };
        if (cur.dir === "asc") return { key, dir: "desc" };
        return defaultSort ?? null; // third click returns to the natural order
      }),
    [defaultSort]
  );

  const setFilter = useCallback((key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v })), []);

  const active =
    !!q ||
    !!from ||
    !!to ||
    (filters ?? []).some((f) => (values[f.key] ?? "") !== (f.initial ?? ""));

  const reset = useCallback(() => {
    setQ("");
    setFrom("");
    setTo("");
    setValues(Object.fromEntries((filters ?? []).map((f) => [f.key, f.initial ?? ""])));
    setSort(defaultSort ?? null);
  }, [filters, defaultSort]);

  return { rows: shown, all: rows, q, setQ, values, setFilter, from, setFrom, to, setTo, sort, toggleSort, total, active, reset };
}

export type TableView<T> = ReturnType<typeof useTableView<T>>;

/* --------------------------------------------------------- TableToolbar -- */

/**
 * Change 25 Part C — what an "Export CSV" click writes.
 *
 * It exports `view.rows`: the current filtered, sorted result, not the underlying
 * table. What you see is what you get, and no new query is issued.
 */
export type CsvExport<T> = {
  /** Base filename; the date is appended and `.csv` added. */
  filename: string;
  columns: CsvColumn<T>[];
};

export function TableToolbar<T>({
  view,
  filters,
  searchPlaceholder = "Search…",
  dateLabel = "Date",
  showDate = true,
  unit,
  csv,
  children,
  className,
}: {
  view: TableView<T>;
  filters?: FilterDef<T>[];
  searchPlaceholder?: string;
  dateLabel?: string;
  showDate?: boolean;
  /** Unit for the summary total, e.g. "pcs". */
  unit?: string;
  /** Adds an Export CSV button that downloads the current filtered view. */
  csv?: CsvExport<T>;
  /** Extra controls (tabs, an export button) rendered on the left. */
  children?: React.ReactNode;
  className?: string;
}) {
  const [sheet, setSheet] = useState(false);
  const hasFilters = (filters ?? []).length > 0 || showDate;
  const filterCount =
    (view.q ? 0 : 0) + // search shown separately
    (filters ?? []).filter((f) => (view.values[f.key] ?? "") !== (f.initial ?? "")).length +
    (view.from ? 1 : 0) +
    (view.to ? 1 : 0);

  const clearBtn = view.active && (
    <button onClick={view.reset} className="inline-flex items-center gap-1 t-xs font-semibold text-t3 hover:text-danger">
      <X size={12} /> Clear
    </button>
  );
  const csvBtn = csv && (
    <button
      onClick={() => downloadCsv(`${csv.filename}-${ymd(new Date())}`, toCsv(view.rows, csv.columns))}
      disabled={view.rows.length === 0}
      className="inline-flex items-center gap-1 t-xs font-semibold text-t3 hover:text-t1 disabled:pointer-events-none disabled:opacity-40"
    >
      <Download size={12} /> Export CSV
    </button>
  );
  const count = (
    <span className="t-xs font-medium tabular-nums text-t3">
      {view.rows.length === view.all.length
        ? `${num(view.all.length)} row${view.all.length === 1 ? "" : "s"}`
        : `${num(view.rows.length)} of ${num(view.all.length)}`}
      {view.total != null && ` · ${num(view.total)}${unit ? ` ${unit}` : ""}`}
    </span>
  );

  const controls = (stacked: boolean) => {
    const dateCls = inputClass("sm", stacked ? "flex-1 text-t2" : "w-[9.25rem] text-t2");
    const selectCls = inputClass("sm", stacked ? "w-full" : "max-w-[11rem] pr-7");
    return (
      <>
        {/* A raw <select> rather than the Select primitive: that one bakes in `w-full`,
            and `cn` is a plain join (no tailwind-merge), so a `w-auto` override loses
            and every filter would stack full-width down the page. */}
        {(filters ?? []).map((f) => (
          <select
            key={f.key}
            value={view.values[f.key] ?? ""}
            onChange={(e) => view.setFilter(f.key, e.target.value)}
            className={selectCls}
            aria-label={f.label}
          >
            <option value="">All {f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}

        {showDate && (
          <span className={cn("flex items-center gap-1.5 t-xs text-t3", stacked && "w-full")}>
            {dateLabel}
            <input type="date" value={view.from} onChange={(e) => view.setFrom(e.target.value)} className={dateCls} aria-label={`${dateLabel} from`} />
            <span aria-hidden>→</span>
            <input type="date" value={view.to} onChange={(e) => view.setTo(e.target.value)} className={dateCls} aria-label={`${dateLabel} to`} />
          </span>
        )}
      </>
    );
  };

  return (
    <div className={cn("mb-3", className)}>
      {/* one row on mobile: search + a Filters button; the rest lives in a sheet */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {children}

        <SearchInput
          size="sm"
          value={view.q}
          onChange={(e) => view.setQ(e.target.value)}
          placeholder={searchPlaceholder}
          wrapClassName="w-full sm:w-60"
        />

        {/* mobile: open filters in a sheet */}
        {hasFilters && (
          <button
            type="button"
            onClick={() => setSheet(true)}
            className={cn(inputClass("sm", "inline-flex w-auto items-center gap-1.5 md:hidden"), filterCount > 0 && "text-t1")}
          >
            <SlidersHorizontal size={13} />
            Filters
            {filterCount > 0 && (
              <span className="grid size-4 place-items-center rounded-full bg-accent t-micro font-bold text-accent-on">{filterCount}</span>
            )}
          </button>

        )}

        {/* desktop: inline controls */}
        <span className="hidden items-center gap-x-3 gap-y-2 md:flex md:flex-wrap">
          {controls(false)}
          {clearBtn}
          {csvBtn}
        </span>

        <span className="ml-auto">{count}</span>
      </div>

      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Filters"
        footer={
          <>
            {clearBtn}
            <span className="ml-auto flex items-center gap-3">
              {csvBtn}
              <button onClick={() => setSheet(false)} className="rounded-lg bg-accent px-4 py-2 t-sm font-semibold text-accent-on active:scale-[0.97]">
                Done
              </button>
            </span>
          </>
        }
      >
        <div className="flex flex-col gap-3">{controls(true)}</div>
      </BottomSheet>
    </div>
  );
}

/* ----------------------------------------------------------- SortHeader -- */

/**
 * A clickable column header. Cycles asc → desc → the table's natural order, so
 * a mis-click is always one more click from undone.
 */
export function SortHeader<T>({
  view,
  sortKey,
  children,
  align = "left",
  className,
}: {
  view: TableView<T>;
  sortKey: string;
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const on = view.sort?.key === sortKey;
  const Icon = !on ? ChevronsUpDown : view.sort!.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => view.toggleSort(sortKey)}
      aria-label={`Sort by ${typeof children === "string" ? children : sortKey}`}
      className={cn(
        "inline-flex items-center gap-1 font-semibold transition-colors duration-100",
        on ? "text-t1" : "text-t3 hover:text-t1",
        align === "right" && "flex-row-reverse",
        className
      )}
    >
      {children}
      <Icon size={11} strokeWidth={2.4} className={on ? "opacity-100" : "opacity-40"} />
    </button>
  );
}
