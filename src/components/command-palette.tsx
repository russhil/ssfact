"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  CornerDownLeft,
  Factory,
  Package,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useMemoKeyboardList } from "@/components/use-keyboard-list";
import type { SearchItem } from "@/app/api/search/route";
import { cn } from "@/lib/cn";

type Action = { label: string; sub: string; href: string };
type Row = SearchItem | (Action & { kind: "action" });

const ICON: Record<string, LucideIcon> = {
  job: ClipboardList,
  product: Package,
  vendor: Factory,
  action: Plus,
};

const GROUP: Record<string, string> = {
  action: "Actions",
  job: "Job cards",
  product: "Products",
  vendor: "Vendors",
};

const MAX = 40;

/** Prefix hits rank above interior hits, so typing "SI-2" surfaces SI-2xx first. */
function score(row: Row, q: string): number {
  const label = row.label.toLowerCase();
  const sub = row.sub.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  if (sub.startsWith(q)) return 2;
  if (sub.includes(q)) return 3;
  return -1;
}

export function CommandPalette({ actions }: { actions: Action[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);

  // ⌘K / Ctrl-K from anywhere, and "/" when not already typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // load the index once, the first time it is actually needed
  useEffect(() => {
    if (!open || items !== null || loading) return;
    setLoading(true);
    fetch("/api/search")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, items, loading]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const needle = q.trim().toLowerCase();
  const pool: Row[] = [...actions.map((a) => ({ ...a, kind: "action" as const })), ...(items ?? [])];
  const rows = needle
    ? pool
        .map((r) => ({ r, s: score(r, needle) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => a.s - b.s)
        .slice(0, MAX)
        .map((x) => x.r)
    : pool.slice(0, MAX);

  const go = useCallback(
    (i: number) => {
      const row = rows[i];
      if (!row) return;
      close();
      router.push(row.href);
    },
    [rows, close, router]
  );

  const { activeIndex, onKeyDown } = useMemoKeyboardList(rows.length, go, close);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={close} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="pop-in relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-card bg-surface elev-hi"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4">
          <Search size={16} strokeWidth={2.2} className="shrink-0 text-t3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search job cards, products, vendors…"
            className="w-full bg-transparent py-3.5 t-body text-t1 outline-none placeholder:text-t3"
          />
          <kbd className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 t-xs font-semibold text-t3">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {loading && items === null && (
            <p className="px-3 py-8 text-center t-sm text-t3">Loading…</p>
          )}

          {!loading && rows.length === 0 && (
            <p className="px-3 py-8 text-center t-sm text-t2">
              No matches for “{q}”
            </p>
          )}

          {rows.map((row, i) => {
            const Icon = ICON[row.kind] ?? Search;
            const head = GROUP[row.kind] !== lastGroup ? (lastGroup = GROUP[row.kind]) : null;
            return (
              <div key={`${row.kind}-${row.href}-${i}`}>
                {head && <div className="px-3 pb-1 pt-3 t-label text-t3">{head}</div>}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-100",
                    i === activeIndex ? "bg-accent-soft" : "hover:bg-surface-2"
                  )}
                >
                  <Icon
                    size={15}
                    strokeWidth={2.1}
                    className={cn("shrink-0", i === activeIndex ? "text-accent" : "text-t3")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate t-body font-semibold">{row.label}</span>
                    {row.sub && <span className="block truncate t-xs text-t3">{row.sub}</span>}
                  </span>
                  {i === activeIndex && <CornerDownLeft size={13} className="shrink-0 text-accent" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
