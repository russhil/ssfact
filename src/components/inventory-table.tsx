"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge, Card, MobileCardList, SortHeader, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { num, pct } from "@/lib/format";
import { MasterDelete } from "@/components/master-delete";
import { deleteFabric, deactivateFabric } from "@/lib/actions";

/**
 * Change 23 Part E — the fabric list, sliceable, with its KPI cards wired to the
 * same thresholds the filter uses.
 *
 * The page used to show headline Low/Short counts you couldn't act on: clicking
 * one told you nothing and there was no way to see just those rows. Now the card
 * IS the filter, and because both read `stockStatus()` the count and the list can
 * never drift apart.
 */

export type FabricRow = {
  id: number;
  name: string;
  unit: string;
  opening: number;
  issued: number;
  available: number;
  usedPct: number;
  // Change 25 Part E: reorderLevel is the per-colour trigger from FabricColorStock.
  // Optional only because /inventory still projects the colour down to four fields —
  // the "Below reorder" filter stays empty until the page passes it through.
  colors: { id: number; color: string; current: number; status: string; reorderLevel?: number | null }[];
};

/** Change 25 Part E — identical to getLowStockAlerts(): a null level is not tracked. */
function belowReorder(c: { current: number; reorderLevel?: number | null }): boolean {
  return c.reorderLevel != null && c.current <= c.reorderLevel;
}

/** One definition of "short" and "low", read by both the KPI cards and the filter. */
export function stockStatus(s: { available: number; usedPct: number }): "short" | "low" | "ok" {
  if (s.available <= 0) return "short";
  if (s.usedPct >= 0.85) return "low";
  return "ok";
}

// Delete is ADMIN-only (Change 36 Part 0); the column is hidden for everyone else.
export function InventoryTable({ rows, canDelete = false }: { rows: FabricRow[]; canDelete?: boolean }) {
  const counts = useMemo(() => {
    const c = { all: rows.length, short: 0, low: 0, ok: 0 };
    for (const r of rows) c[stockStatus(r)]++;
    return c;
  }, [rows]);

  const totalAvail = useMemo(() => rows.reduce((a, s) => a + Math.max(0, s.available), 0), [rows]);

  const filters: FilterDef<FabricRow>[] = useMemo(
    () => [
      {
        key: "stock",
        label: "stock levels",
        options: [
          { value: "short", label: "Short (available ≤ 0)" },
          { value: "low", label: "Low (≥85% used)" },
          { value: "ok", label: "Healthy" },
        ],
        match: (r, v) => stockStatus(r) === v,
      },
      {
        // Change 25 Part E: fabric stock is held per colour, so a fabric is on the buy
        // list the moment ANY one of its colours hits its own trigger — the roll-up
        // Available can look healthy while a single shade is out.
        key: "reorder",
        label: "stock",
        options: [{ value: "LOW", label: "Below reorder" }],
        match: (r) => r.colors.some(belowReorder),
      },
    ],
    []
  );

  const csv: CsvExport<FabricRow> = {
    filename: "inventory",
    columns: [
      { header: "fabric", value: (r) => r.name },
      { header: "unit", value: (r) => r.unit },
      // the colour chips under the fabric name, one field
      { header: "colours", value: (r) => r.colors.map((c) => `${c.color} ${c.current}`).join("; ") },
      { header: "opening", value: (r) => r.opening },
      { header: "issued", value: (r) => r.issued },
      { header: "available", value: (r) => r.available },
      { header: "used_pct", value: (r) => r.usedPct },
      { header: "status", value: (r) => (stockStatus(r) === "short" ? "Indent" : stockStatus(r) === "low" ? "Low" : "OK") },
    ],
  };

  const view = useTableView<FabricRow>({
    id: "inv",
    rows,
    filters,
    search: (r) => [r.name, ...r.colors.map((c) => c.color)],
    sorts: {
      name: (r) => r.name,
      opening: (r) => r.opening,
      issued: (r) => r.issued,
      available: (r) => r.available,
      used: (r) => r.usedPct,
    },
    sum: (r) => Math.max(0, r.available),
  });

  const active = view.values.stock ?? "";
  const kpi = (key: string) => () => view.setFilter("stock", active === key ? "" : key);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
        <KpiCard label="Fabrics Tracked" value={counts.all} onClick={kpi("")} on={active === ""} />
        <KpiCard label="Available Stock" value={num(totalAvail)} />
        <KpiCard label="Low (≥85% used)" value={counts.low} tone="text-warn" onClick={kpi("low")} on={active === "low"} />
        <KpiCard label="Short / Indent" value={counts.short} tone="text-danger" onClick={kpi("short")} on={active === "short"} />
      </div>

      <Card className="p-5">
        <TableToolbar view={view} filters={filters} searchPlaceholder="Search fabric or colour…" showDate={false} unit="available" csv={csv} />

        {/* phones: a card per fabric */}
        <MobileCardList
          className="md:hidden"
          rows={view.rows}
          keyOf={(s) => s.id}
          empty={<p className="px-2 py-10 text-center t-sm text-muted">{rows.length === 0 ? "No fabrics" : "No fabrics match these filters"}</p>}
          renderCard={(s) => {
            const st = stockStatus(s);
            const w = Math.min(100, Math.max(0, s.usedPct * 100));
            return (
              <div className="rounded-card bg-surface p-4 elev">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/inventory/${s.id}`} className="t-body font-bold text-primary-ink">
                    {s.name}
                    <span className="ml-1.5 t-micro font-normal text-faint">{s.unit}</span>
                  </Link>
                  {st === "short" ? <Badge tone="danger">Indent</Badge> : st === "low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className={`h-full rounded-full ${st === "short" ? "bg-danger" : st === "low" ? "bg-warn" : "bg-primary"}`} style={{ width: `${w}%` }} />
                  </div>
                  <span className="tnum t-xs font-semibold">{pct(s.usedPct)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 t-sm">
                  <span className={`tnum ${s.available <= 0 ? "font-semibold text-danger" : ""}`}>
                    <b>{num(s.available)}</b> avail
                  </span>
                  <span className="tnum text-t3">opening {num(s.opening)}</span>
                  <span className="tnum text-t3">issued {num(s.issued)}</span>
                </div>
                {s.colors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.colors.slice(0, 8).map((c) => (
                      <span
                        key={c.id}
                        className={`rounded px-1.5 py-0.5 t-micro font-semibold tnum ${
                          c.status === "Indent" ? "bg-danger-soft text-danger" : c.status === "Low" ? "bg-warn-soft text-warn" : "bg-surface-2 text-t2"
                        }`}
                      >
                        {c.color} {num(c.current)}
                      </span>
                    ))}
                    {s.colors.length > 8 && <span className="self-center t-micro text-faint">+{s.colors.length - 8}</span>}
                  </div>
                )}
                {canDelete && (
                  <div className="mt-2 flex justify-end">
                    <MasterDelete
                      kind="fabric"
                      id={s.id}
                      label="Fabric"
                      onDelete={() => deleteFabric({ id: s.id })}
                      onDeactivate={() => deactivateFabric({ id: s.id, active: false })}
                    />
                  </div>
                )}
              </div>
            );
          }}
        />

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5"><SortHeader view={view} sortKey="name">Fabric</SortHeader></th>
                <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="opening" align="right">Opening</SortHeader></th>
                <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="issued" align="right">Issued</SortHeader></th>
                <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="available" align="right">Available</SortHeader></th>
                <th className="px-4 py-2.5"><SortHeader view={view} sortKey="used">Utilisation</SortHeader></th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                {canDelete && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((s) => {
                const w = Math.min(100, Math.max(0, s.usedPct * 100));
                const st = stockStatus(s);
                return (
                  <tr key={s.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/inventory/${s.id}`} className="font-semibold text-primary-ink hover:underline">
                        {s.name}
                      </Link>
                      <span className="ml-1.5 t-micro text-faint">{s.unit}</span>
                      {s.colors.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {s.colors.slice(0, 10).map((c) => (
                            <span
                              key={c.id}
                              title={`${c.color}: ${num(c.current)} ${s.unit}`}
                              className={`rounded px-1.5 py-0.5 t-micro font-semibold tnum ${
                                c.status === "Indent"
                                  ? "bg-danger-soft text-danger"
                                  : c.status === "Low"
                                    ? "bg-warn-soft text-warn"
                                    : "bg-surface-2 text-t2"
                              }`}
                            >
                              {c.color} {num(c.current)}
                            </span>
                          ))}
                          {s.colors.length > 10 && (
                            <span className="self-center t-micro text-faint">+{s.colors.length - 10} more</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-t2 tnum">{num(s.opening)}</td>
                    <td className="px-4 py-2.5 text-right text-t2 tnum">{num(s.issued)}</td>
                    <td className={`px-4 py-2.5 text-right font-bold tnum ${s.available <= 0 ? "text-danger" : ""}`}>
                      {num(s.available)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className={`h-full rounded-full ${st === "short" ? "bg-danger" : st === "low" ? "bg-warn" : "bg-primary"}`}
                            style={{ width: `${w}%` }}
                          />
                        </div>
                        <span className="tnum t-xs font-semibold">{pct(s.usedPct)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {st === "short" ? <Badge tone="danger">Indent</Badge> : st === "low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-2.5 text-right">
                        <MasterDelete
                          kind="fabric"
                          id={s.id}
                          label="Fabric"
                          onDelete={() => deleteFabric({ id: s.id })}
                          onDeactivate={() => deactivateFabric({ id: s.id, active: false })}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {view.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    {rows.length === 0 ? "No fabrics" : "No fabrics match these filters"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function KpiCard({
  label,
  value,
  tone,
  onClick,
  on,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  onClick?: () => void;
  on?: boolean;
}) {
  const body = (
    <>
      <div className="t-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1.5 t-display font-extrabold tnum ${tone ?? ""}`}>{value}</div>
    </>
  );
  if (!onClick) return <Card className="p-4">{body}</Card>;
  return (
    <Card
      className={`cursor-pointer p-4 text-left transition-colors duration-150 hover:bg-surface-2 ${on ? "ring-2 ring-accent/40" : ""}`}
    >
      <button type="button" onClick={onClick} className="w-full text-left" aria-pressed={on}>
        {body}
      </button>
    </Card>
  );
}
