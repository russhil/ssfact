"use client";

/**
 * Change 40 — the phone rendering of ONE cutting layer. Same props and the same
 * `onChange(patch: Partial<LayerState>)` contract as the desktop CuttingLayerGrid,
 * so every server action, payload and helper is untouched — only the presentation
 * forks. The desktop grid is a wide colour×size matrix; a phone can't show that,
 * so here:
 *   • size ratio  → a summary line that opens a sheet
 *   • cut qty     → a per-colour card list; each total/bundles tap opens a numpad
 *   • the derived per-size cells → read-only chips (already derived on desktop)
 *   • fabric      → per-colour issued/balance via numpad, used derived
 *
 * All the maths lives in layer-grid.ts helpers (deriveLayerCells, layerTotal,
 * layerFabricTotals, …) exactly as the desktop path uses them.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { splitByRatio, orderSizes, sizeKey } from "@/lib/job-labels";
import { num } from "@/lib/format";
import { useIsMobile } from "@/lib/use-is-mobile";
import { NumpadSheet } from "@/components/ui/numpad-sheet";
import { BottomSheet } from "@/components/ui/sheet";
import {
  CuttingLayerGrid,
  COLORLESS,
  cellKey,
  deriveLayerCells,
  layerTotal,
  layerFabricTotals,
  numOrNull,
  type LayerState,
  type LayerFabricRow,
} from "./layer-grid";

type GridProps = {
  layer: LayerState;
  colours: string[];
  masters: string[];
  vendors: string[];
  onChange: (patch: Partial<LayerState>) => void;
  showIdentity?: boolean;
};

/**
 * The layer editor that suits the viewport: the desktop matrix at `md`+, the
 * phone card/keypad flow below it. Chosen by `useIsMobile` (initial `false` →
 * matches SSR, then swaps after mount; the layer state lives in the parent, so
 * the swap never loses input). Drop-in for CuttingLayerGrid — same props.
 */
export function ResponsiveCuttingLayerGrid(props: GridProps) {
  const mobile = useIsMobile();
  return mobile ? <CuttingLayerGridMobile {...props} /> : <CuttingLayerGrid {...props} />;
}

type NumEdit = { title: string; subtitle?: string; value: string; integer?: boolean; apply: (v: string) => void };

export function CuttingLayerGridMobile({
  layer,
  colours,
  masters,
  vendors,
  onChange,
  showIdentity = true,
}: {
  layer: LayerState;
  colours: string[];
  masters: string[];
  vendors: string[];
  onChange: (patch: Partial<LayerState>) => void;
  showIdentity?: boolean;
}) {
  const L = layer;
  const [edit, setEdit] = useState<NumEdit | null>(null);
  const [ratioOpen, setRatioOpen] = useState(false);

  const cells = deriveLayerCells(L, colours);
  const total = layerTotal(cells);
  const colourless = colours.length === 0 || (colours.length === 1 && colours[0] === "");
  const gridColours = colourless ? [""] : colours;
  const totals = layerFabricTotals(L, gridColours);
  const layerLen = numOrNull(L.layerLength);
  const avgMeasured = layerLen != null && total > 0 ? layerLen / total : null;
  const bundleTotal = gridColours.reduce((a, c) => a + Math.max(0, Math.round(L.bundles?.[c] ?? 0)), 0);

  // ── mutations (identical semantics to the desktop closures) ──
  const addSize = (raw: string) => {
    const s = sizeKey(raw);
    if (!s || L.sizes.includes(s)) return onChange({ newSize: "" });
    const w = L.ratio.length ? L.ratio.reduce((a, [, x]) => a + x, 0) / L.ratio.length : 1;
    onChange({
      sizes: [...L.sizes, s].sort(orderSizes),
      ratio: [...L.ratio, [s, w] as [string, number]].sort((a, b) => orderSizes(a[0], b[0])),
      newSize: "",
    });
  };
  const removeSize = (s: string) =>
    onChange({ sizes: L.sizes.filter((x) => x !== s), ratio: L.ratio.filter(([x]) => x !== s) });
  const setRatioWeight = (s: string, w: number) =>
    onChange({ ratio: L.ratio.map((row) => (row[0] === s ? ([row[0], Math.max(0, w)] as [string, number]) : row)) });
  const setColourTotal = (c: string, v: string) =>
    onChange({ colourTotals: { ...L.colourTotals, [c]: Math.max(0, Math.round(numOrNull(v) ?? 0)) } });
  const setBundles = (c: string, v: string) =>
    onChange({ bundles: { ...(L.bundles ?? {}), [c]: Math.max(0, Math.round(numOrNull(v) ?? 0)) } });
  const setFabric = (c: string, k: keyof LayerFabricRow, v: string) =>
    onChange({ byColour: { ...(L.byColour ?? {}), [c]: { ...(L.byColour?.[c] ?? { issued: "", balance: "" }), [k]: v } } });

  const ratioSummary = L.sizes.map((s) => `${s}·${L.ratio.find(([x]) => x === s)?.[1] ?? 0}`).join("  ");

  return (
    <div className="flex flex-col gap-4">
      {/* ── sizes ── */}
      <section>
        <SectionLabel>Cut sizing</SectionLabel>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {L.sizes.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 t-sm font-semibold">
              {s}
              <button type="button" onClick={() => removeSize(s)} aria-label={`Remove ${s}`} className="text-faint active:text-danger">
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            value={L.newSize}
            onChange={(e) => onChange({ newSize: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSize(L.newSize);
              }
            }}
            onBlur={() => addSize(L.newSize)}
            placeholder="+ size"
            className="w-16 rounded-full border border-dashed border-border px-2.5 py-1 t-sm uppercase outline-none focus:border-primary"
          />
        </div>
      </section>

      {/* ── size ratio (opens a sheet) ── */}
      <section>
        <SectionLabel>Size ratio</SectionLabel>
        <button
          type="button"
          onClick={() => setRatioOpen(true)}
          className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-3 text-left active:scale-[0.99]"
        >
          <span className="truncate t-sm font-semibold tnum text-t1">{ratioSummary || "Set the size split"}</span>
          <span className="shrink-0 t-xs font-semibold text-accent">Edit</span>
        </button>
      </section>

      {/* ── cut quantity by colour ── */}
      <section>
        <div className="flex items-center justify-between">
          <SectionLabel>{colourless ? "Cut quantity" : "Cut quantity by colour"}</SectionLabel>
          <span className="t-xs text-muted tnum">
            {num(total)} pcs{bundleTotal > 0 ? ` · ${num(bundleTotal)} bundles` : ""}
          </span>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          {gridColours.map((c) => {
            const totalC = Math.max(0, Math.round(L.colourTotals?.[c] ?? 0));
            const bundlesC = L.bundles?.[c] ?? 0;
            return (
              <div key={c || COLORLESS} className="rounded-xl border border-hairline p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="t-body font-semibold text-t1">{c || COLORLESS}</span>
                  <div className="flex items-center gap-2">
                    <ValueChip
                      label="Qty"
                      value={totalC ? num(totalC) : ""}
                      placeholder="0"
                      onTap={() =>
                        setEdit({ title: `${c || "Quantity"}`, subtitle: "Pieces cut on this lay", integer: true, value: totalC ? String(totalC) : "", apply: (v) => setColourTotal(c, v) })
                      }
                    />
                    <ValueChip
                      label="Bundles"
                      value={bundlesC ? num(bundlesC) : ""}
                      placeholder="—"
                      muted
                      onTap={() =>
                        setEdit({ title: `${c || ""} bundles`, subtitle: "Tied bundles", integer: true, value: bundlesC ? String(bundlesC) : "", apply: (v) => setBundles(c, v) })
                      }
                    />
                  </div>
                </div>
                {/* derived per-size cells — read-only, mirrors desktop */}
                {totalC > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {L.sizes.map((s) => {
                      const q = cells.get(cellKey(s, c)) ?? 0;
                      return (
                        <span key={s} className="rounded-md bg-surface-2 px-2 py-0.5 t-xs tnum text-t2">
                          <span className="font-semibold text-faint">{s}</span> {num(q)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── fabric for this lay ── */}
      <section className="border-t border-hairline pt-3">
        <SectionLabel>Fabric</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <FieldChip
            label="layer length (m)"
            value={L.layerLength}
            placeholder="—"
            onTap={() => setEdit({ title: "Layer length", subtitle: "metres", value: L.layerLength, apply: (v) => onChange({ layerLength: v }) })}
          />
          <ReadChip label="avg m/pc (actual)" value={avgMeasured != null ? num(avgMeasured, 3) : "—"} />
          <FieldChip
            label="avg m/pc (est)"
            value={L.avg}
            placeholder="—"
            onTap={() => setEdit({ title: "Avg m/pc (est)", value: L.avg, apply: (v) => onChange({ avg: v }) })}
          />
          <FieldChip
            label="rolls"
            value={L.rolls}
            placeholder="—"
            onTap={() => setEdit({ title: "Rolls", integer: true, value: L.rolls, apply: (v) => onChange({ rolls: v }) })}
          />
        </div>

        {/* per-colour issued / balance */}
        {gridColours.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {gridColours.map((c) => {
              const row = L.byColour?.[c] ?? { issued: "", balance: "" };
              const i = numOrNull(row.issued);
              const b = numOrNull(row.balance);
              const used = i != null || b != null ? Math.round(((i ?? 0) - (b ?? 0)) * 100) / 100 : null;
              return (
                <div key={c || COLORLESS} className="flex items-center gap-2 rounded-xl border border-hairline p-2.5">
                  <span className="min-w-0 flex-1 truncate t-sm font-semibold text-t1">{c || COLORLESS}</span>
                  <ValueChip
                    label="issued"
                    value={row.issued}
                    placeholder="—"
                    onTap={() => setEdit({ title: `${c || ""} issued`, subtitle: "metres", value: row.issued, apply: (v) => setFabric(c, "issued", v) })}
                  />
                  <ValueChip
                    label="balance"
                    value={row.balance}
                    placeholder="—"
                    onTap={() => setEdit({ title: `${c || ""} balance`, subtitle: "metres", value: row.balance, apply: (v) => setFabric(c, "balance", v) })}
                  />
                  <div className="w-14 text-right">
                    <div className="t-micro uppercase text-faint">used</div>
                    <div className={`t-sm font-semibold tnum ${used != null && used < 0 ? "text-danger" : "text-t1"}`}>{used != null ? num(used, 2) : "—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* roll-up */}
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-center">
          <RollUp label="issued" value={totals.issued != null ? num(totals.issued, 2) : "—"} />
          <RollUp label="balance" value={totals.balance != null ? num(totals.balance, 2) : "—"} />
          <RollUp label="used" value={totals.used != null ? num(totals.used, 2) : "—"} danger={totals.used != null && totals.used < 0} />
        </div>
      </section>

      {/* ── lay identity ── */}
      {showIdentity && (
        <section className="border-t border-hairline pt-3">
          <SectionLabel>Lay details</SectionLabel>
          <div className="mt-2 flex flex-col gap-2">
            <label className="block">
              <span className="mb-0.5 block t-micro uppercase text-faint">cut date</span>
              <input type="date" value={L.date} onChange={(e) => onChange({ date: e.target.value })} className={nativeInp} />
            </label>
            <label className="block">
              <span className="mb-0.5 block t-micro uppercase text-faint">master</span>
              <select value={L.master} onChange={(e) => onChange({ master: e.target.value })} className={nativeInp}>
                <option value="">default</option>
                {masters.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block t-micro uppercase text-faint">vendor</span>
              <select value={L.vendor} onChange={(e) => onChange({ vendor: e.target.value })} className={nativeInp}>
                <option value="">card vendor</option>
                {vendors.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {/* ── the one numpad, driven by whichever cell was tapped ── */}
      <NumpadSheet
        open={edit != null}
        onClose={() => setEdit(null)}
        title={edit?.title}
        subtitle={edit?.subtitle}
        integer={edit?.integer}
        value={edit?.value ?? ""}
        onChange={(v) => edit?.apply(v)}
      />

      {/* ── size-ratio sheet ── */}
      <BottomSheet
        open={ratioOpen}
        onClose={() => setRatioOpen(false)}
        title="Size ratio"
        subtitle="The split each colour's total is divided by"
        footer={
          <button onClick={() => setRatioOpen(false)} className="ml-auto rounded-lg bg-accent px-5 py-2 t-sm font-semibold text-accent-on active:scale-[0.97]">
            Done
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {L.sizes.map((s) => {
            const w = L.ratio.find(([x]) => x === s)?.[1] ?? 0;
            // live preview against the biggest colour total (or the lay total)
            const preview = splitByRatio(total, L.ratio.filter(([x]) => L.sizes.includes(x))).get(s) ?? 0;
            return (
              <div key={s} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5">
                <span className="w-12 t-body font-bold text-t1">{s}</span>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={w}
                  onChange={(e) => setRatioWeight(s, +e.target.value)}
                  className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-center t-body font-bold tnum outline-none focus:border-primary"
                />
                <span className="ml-auto t-sm text-faint tnum">≈ {num(preview)} pc</span>
              </div>
            );
          })}
          {L.sizes.length === 0 && <p className="py-6 text-center t-sm text-muted">Add a size first.</p>}
        </div>
      </BottomSheet>
    </div>
  );
}

const nativeInp = "w-full rounded-lg border border-border bg-surface px-3 py-2 t-sm outline-none focus:border-primary";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="t-xs font-semibold text-t1">{children}</span>;
}

/** A tappable label+value chip that opens the numpad. */
function ValueChip({
  label,
  value,
  placeholder,
  muted,
  onTap,
}: {
  label: string;
  value: string;
  placeholder: string;
  muted?: boolean;
  onTap: () => void;
}) {
  return (
    <button type="button" onClick={onTap} className="min-w-[3.75rem] rounded-lg border border-border bg-surface px-2.5 py-1.5 text-right active:scale-[0.97]">
      <span className="block t-micro uppercase text-faint">{label}</span>
      <span className={`block t-body font-bold tnum ${value ? (muted ? "text-t2" : "text-t1") : "text-faint"}`}>{value || placeholder}</span>
    </button>
  );
}

/** Full-width tappable field (fabric numbers). */
function FieldChip({ label, value, placeholder, onTap }: { label: string; value: string; placeholder: string; onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} className="rounded-lg border border-border bg-surface px-3 py-2 text-left active:scale-[0.98]">
      <span className="block t-micro uppercase text-faint">{label}</span>
      <span className={`block t-body font-bold tnum ${value ? "text-t1" : "text-faint"}`}>{value || placeholder}</span>
    </button>
  );
}

function ReadChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <span className="block t-micro uppercase text-faint">{label}</span>
      <span className="block t-body font-bold tnum text-t1">{value}</span>
    </div>
  );
}

function RollUp({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="t-micro uppercase text-faint">{label}</div>
      <div className={`t-body font-bold tnum ${danger ? "text-danger" : "text-t1"}`}>{value}</div>
    </div>
  );
}
