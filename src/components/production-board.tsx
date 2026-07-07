"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardRow, BoardFilterOptions } from "@/lib/board";
import { STAGE_LABEL, stageTone, type Stage } from "@/lib/job-labels";
import { JobStageSelect } from "@/components/job-stage-select";
import { Badge } from "@/components/ui";
import { num, inr, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

// ── multi-select filter (button + checkbox popover) ────────────────────────────
function MultiFilter({
  label,
  options,
  selected,
  onToggle,
  fmt,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  fmt?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold",
          selected.size ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-slate-600"
        )}
      >
        {label}{selected.size > 0 && ` · ${selected.size}`}
        <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
            {options.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-slate-50">
                <input type="checkbox" checked={selected.has(o)} onChange={() => onToggle(o)} className="accent-primary" />
                <span className="truncate">{fmt ? fmt(o) : o}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── derived cell renderers ─────────────────────────────────────────────────────
function StitchBalance({ v }: { v: number }) {
  if (v === 0) return <span className="text-slate-400 tnum">0</span>;
  if (v > 0) return <span className="font-semibold text-emerald-600 tnum">+{num(v)} extra</span>;
  return <span className="font-semibold text-amber-600 tnum">{num(v)}</span>;
}

function DaysToEtd({ d, closed }: { d: number | null; closed: boolean }) {
  if (d == null) return <span className="text-slate-300">—</span>;
  if (closed) return <span className="text-slate-400 tnum">{d}</span>;
  if (d < 0) return <span className="font-bold text-danger tnum">{d}</span>;
  if (d <= 3) return <span className="font-semibold text-amber-600 tnum">{d}</span>;
  return <span className="text-slate-500 tnum">{d}</span>;
}

const rowTint = (r: BoardRow) =>
  r.status === "CLOSED"
    ? "bg-slate-50/60 text-slate-400"
    : r.overdue
      ? "bg-danger-soft/50 border-l-2 border-l-danger"
      : r.stage === "ON_MACHINE" || r.stage === "FINISHING"
        ? "bg-amber-50 border-l-2 border-l-amber-300"
        : r.stage === "DISPATCH"
          ? "bg-ok-soft/40"
          : "";

type SortKey = "si" | "order" | "item" | "cut" | "disp" | "bal" | "avg" | "vendor" | "etd" | "days" | "stage";

export function ProductionBoard({
  rows,
  filterOptions,
  canSeeCost,
}: {
  rows: BoardRow[];
  filterOptions: BoardFilterOptions;
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [stages, setStages] = useState<Set<string>>(new Set());
  const [vendors, setVendors] = useState<Set<string>>(new Set());
  const [masters, setMasters] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [fabrics, setFabrics] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"all" | "active" | "closed">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [groupBySI, setGroupBySI] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggler = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (stages.size && !stages.has(r.stage)) return false;
      if (vendors.size && !vendors.has(r.vendor)) return false;
      if (masters.size && (!r.cutMaster || !masters.has(r.cutMaster))) return false;
      if (products.size && !products.has(r.item)) return false;
      if (fabrics.size && (!r.fabricName || !fabrics.has(r.fabricName))) return false;
      if (status === "active" && r.status !== "ACTIVE") return false;
      if (status === "closed" && r.status !== "CLOSED") return false;
      if (overdueOnly && !r.overdue) return false;
      if (!needle) return true;
      return (
        r.siNo.toLowerCase().includes(needle) ||
        r.sku.toLowerCase().includes(needle) ||
        r.item.toLowerCase().includes(needle) ||
        r.vendor.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, stages, vendors, masters, products, fabrics, status, overdueOnly]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: BoardRow): number | string => {
      switch (sortKey) {
        case "si": return r.siNo;
        case "order": return r.orderDate?.getTime() ?? -Infinity;
        case "item": return r.item.toLowerCase();
        case "cut": return r.cutQty;
        case "disp": return r.dispatchedQty;
        case "bal": return r.stitchBalance;
        case "avg": return r.avg ?? -Infinity;
        case "vendor": return r.vendor.toLowerCase();
        case "etd": return r.plannedEtd?.getTime() ?? Infinity;
        case "days": return r.daysToEtd ?? Infinity; // blank ETD sorts last
        case "stage": return r.stage;
      }
    };
    return [...shown].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.id - b.id;
    });
  }, [shown, sortKey, sortDir]);

  function sortOn(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "days" || k === "etd" || k === "order" ? "asc" : "asc"); }
  }

  // group by SI (Part F)
  const groups = useMemo(() => {
    if (!groupBySI) return null;
    const m = new Map<string, BoardRow[]>();
    for (const r of sorted) (m.get(r.siNo) ?? m.set(r.siNo, []).get(r.siNo)!).push(r);
    return [...m.entries()];
  }, [sorted, groupBySI]);

  const colCount = canSeeCost ? 14 : 13;
  const Th = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th
      className={cn("px-2 py-2 font-semibold whitespace-nowrap", right && "text-right", k && "cursor-pointer select-none hover:text-ink")}
      onClick={k ? () => sortOn(k) : undefined}
    >
      {children}{k && sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div>
      {/* filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SI, SKU, item, vendor…"
            className="w-60 rounded-lg border border-border bg-surface py-1.5 pl-8 pr-2.5 text-[12px] outline-none focus:border-primary"
          />
        </div>
        <MultiFilter label="Stage" options={filterOptions.stages} selected={stages} onToggle={toggler(setStages)} fmt={(s) => STAGE_LABEL[s as Stage]} />
        <MultiFilter label="Vendor" options={filterOptions.vendors} selected={vendors} onToggle={toggler(setVendors)} />
        <MultiFilter label="Cut master" options={filterOptions.cuttingMasters} selected={masters} onToggle={toggler(setMasters)} />
        <MultiFilter label="Product" options={filterOptions.products} selected={products} onToggle={toggler(setProducts)} />
        <MultiFilter label="Fabric" options={filterOptions.fabrics} selected={fabrics} onToggle={toggler(setFabrics)} />

        <div className="flex rounded-lg border border-border p-0.5">
          {(["all", "active", "closed"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cn("rounded px-2.5 py-1 text-[12px] font-semibold capitalize", status === s ? "bg-primary text-white" : "text-slate-500 hover:text-ink")}>{s}</button>
          ))}
        </div>
        <button onClick={() => setOverdueOnly((o) => !o)} className={cn("rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold", overdueOnly ? "border-danger bg-danger-soft text-danger" : "border-border bg-surface text-slate-600")}>
          Overdue only
        </button>
        <button onClick={() => setGroupBySI((g) => !g)} className={cn("rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold", groupBySI ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-surface text-slate-600")}>
          Group by SI
        </button>
        <span className="ml-auto text-[12px] text-muted">{shown.length} of {rows.length}</span>
      </div>

      {/* desktop table */}
      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface md:block">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-faint">
              <Th k="si">SI</Th>
              <Th k="order">Order</Th>
              <Th k="item">SKU / Item</Th>
              {canSeeCost && <Th k={undefined} right>MRP</Th>}
              <Th k="cut" right>Cut</Th>
              <Th k="disp" right>Disp</Th>
              <Th k="bal" right>Stitch bal</Th>
              <Th>Fabric</Th>
              <Th k="avg" right>Avg</Th>
              <Th k="vendor">Vendor</Th>
              <Th>Cut master</Th>
              <Th k="etd">ETD</Th>
              <Th k="days" right>Days</Th>
              <Th k="stage">Stage</Th>
            </tr>
          </thead>
          <tbody>
            {!groupBySI &&
              sorted.map((r) => (
                <BoardTr key={r.id} r={r} canSeeCost={canSeeCost} onOpen={() => router.push(`/job-cards/${r.slug}`)} />
              ))}

            {groupBySI &&
              groups!.map(([si, members]) => {
                if (members.length === 1) {
                  return <BoardTr key={members[0].id} r={members[0]} canSeeCost={canSeeCost} onOpen={() => router.push(`/job-cards/${members[0].slug}`)} />;
                }
                const cut = members.reduce((a, m) => a + m.cutQty, 0);
                const disp = members.reduce((a, m) => a + m.dispatchedQty, 0);
                const worst = members.reduce<number | null>((a, m) => (m.daysToEtd == null ? a : a == null ? m.daysToEtd : Math.min(a, m.daysToEtd)), null);
                const uniqueStages = [...new Set(members.map((m) => m.stage))];
                const isOpen = expanded.has(si);
                const anyOverdue = members.some((m) => m.overdue);
                return (
                  <Fragment key={si}>
                    <tr
                      onClick={() => setExpanded((p) => { const n = new Set(p); n.has(si) ? n.delete(si) : n.add(si); return n; })}
                      className={cn("cursor-pointer border-b border-border font-semibold", anyOverdue ? "bg-danger-soft/40" : "bg-slate-50")}
                    >
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{si}
                          <Badge tone="default">{members.length} splits</Badge>
                        </span>
                      </td>
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2 text-slate-500">{members.length} vendor splits</td>
                      {canSeeCost && <td />}
                      <td className="px-2 py-2 text-right tnum">{num(cut)}</td>
                      <td className="px-2 py-2 text-right tnum">{num(disp)}</td>
                      <td className="px-2 py-2 text-right"><StitchBalance v={disp - cut} /></td>
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2 text-slate-500">{[...new Set(members.map((m) => m.vendor))].length} vendors</td>
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2 text-right"><DaysToEtd d={worst} closed={false} /></td>
                      <td className="px-2 py-2">
                        {uniqueStages.length === 1 ? <Badge tone={stageTone(uniqueStages[0])}>{STAGE_LABEL[uniqueStages[0]]}</Badge> : <Badge tone="warn">Mixed</Badge>}
                      </td>
                    </tr>
                    {isOpen && members.map((r) => <BoardTr key={r.id} r={r} canSeeCost={canSeeCost} indent onOpen={() => router.push(`/job-cards/${r.slug}`)} />)}
                  </Fragment>
                );
              })}

            {shown.length === 0 && (
              <tr><td colSpan={colCount} className="px-2 py-10 text-center text-[12px] text-muted">No job cards match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* mobile card list (most-urgent first, flat) */}
      <div className="space-y-2 md:hidden">
        {sorted.map((r) => (
          <button key={r.id} onClick={() => router.push(`/job-cards/${r.slug}`)} className={cn("block w-full rounded-card border border-border bg-surface p-3 text-left", rowTint(r))}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{r.siNo} · <span className="font-medium text-slate-600">{r.item}</span></span>
              <Badge tone={stageTone(r.stage)}>{STAGE_LABEL[r.stage]}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
              <span>{r.vendor}</span>
              <span>Stitch bal: <StitchBalance v={r.stitchBalance} /></span>
              <span>ETD {fmtDate(r.plannedEtd)} · <DaysToEtd d={r.daysToEtd} closed={r.status === "CLOSED"} /> d</span>
            </div>
          </button>
        ))}
        {shown.length === 0 && <p className="py-8 text-center text-[12px] text-muted">No job cards match these filters.</p>}
      </div>
    </div>
  );
}

function BoardTr({ r, canSeeCost, indent, onOpen }: { r: BoardRow; canSeeCost: boolean; indent?: boolean; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className={cn("cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/70", rowTint(r))}>
      <td className={cn("px-2 py-1.5 font-bold text-primary-ink whitespace-nowrap", indent && "pl-6")}>{r.siNo}</td>
      <td className="px-2 py-1.5 text-slate-500 tnum whitespace-nowrap">{fmtDate(r.orderDate)}</td>
      <td className="px-2 py-1.5">
        <div className="font-semibold text-slate-700">{r.item}</div>
        <div className="text-[10px] text-faint">{r.sku !== "—" ? r.sku : ""}{r.styleNo !== "—" ? ` · ${r.styleNo}` : ""}{!r.hasProduct && <span className="ml-1 text-amber-600">·MTO</span>}</div>
      </td>
      {canSeeCost && <td className="px-2 py-1.5 text-right tnum text-slate-500">{inr(r.mrp)}</td>}
      <td className="px-2 py-1.5 text-right tnum">{num(r.cutQty)}</td>
      <td className="px-2 py-1.5 text-right tnum">{num(r.dispatchedQty)}</td>
      <td className="px-2 py-1.5 text-right"><StitchBalance v={r.stitchBalance} /></td>
      <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{r.fabricName ?? "—"}</td>
      <td className="px-2 py-1.5 text-right tnum text-slate-500">{r.avg != null ? `${num(r.avg, 3)} ${r.unit === "KG" ? "kg" : "m"}` : "—"}</td>
      <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.vendor}</td>
      <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{r.cutMaster ?? "—"}</td>
      <td className="px-2 py-1.5 text-slate-500 tnum whitespace-nowrap">{fmtDate(r.plannedEtd)}</td>
      <td className="px-2 py-1.5 text-right"><DaysToEtd d={r.daysToEtd} closed={r.status === "CLOSED"} /></td>
      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
        <JobStageSelect jobCardId={r.id} stage={r.stage} />
      </td>
    </tr>
  );
}
