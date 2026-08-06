"use client";

/**
 * Change 38 Part D — ONE cutting-layer UI, used by every layer everywhere.
 *
 * Until now Layer 1 and layers 2+ were two forked code paths. Layer 1 had a Cut Qty box, a
 * ratio/manual toggle for sizes and another for colours, and used the card's size ratio.
 * Added layers had none of that and instead carried a "Fill [colour] [qty] · apply size ratio"
 * helper that Layer 1 never showed. Same data model, two visual languages, and the colour
 * split even resolved differently in each (see resolveColourRatio).
 *
 * Everything a lay needs now lives here and every layer renders it, so Layer 1 and Layer N are
 * the same controls. Change 39 A: entry is now one TOTAL per colour (size split derived from the
 * lay's own ratio) — the old cut-qty box and colour-ratio machinery are gone.
 *
 * Also the single home for the cell-key/parse helpers that were copy-pasted into three files.
 */

import { splitByRatio, orderSizes, sizeKey } from "@/lib/job-labels";
import { num } from "@/lib/format";
import { X } from "lucide-react";

export const COLORLESS = "—";

export const cellKey = (size: string, colour: string) => `${size}|||${colour}`;
export const splitCellKey = (k: string): [string, string] => {
  const i = k.indexOf("|||");
  return [k.slice(0, i), k.slice(i + 3)];
};
export const numOrNull = (s: string): number | null => (s.trim() === "" || Number.isNaN(+s) ? null : +s);
export const intOrNull = (s: string): number | null => (s.trim() === "" || Number.isNaN(+s) ? null : Math.round(+s));

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Change 38 Part B — the two figures a human reads off the lay: metres ISSUED to it, and
 * metres left over (BALANCE). Used is derived, never typed.
 */
export type LayerFabricRow = { issued: string; balance: string };

export type LayerState = {
  label: string;
  date: string;
  master: string;
  vendor: string;
  avg: string;
  rolls: string;
  /** this lay's own size list — a real lay may drop 3XL or add 4XL (Change 26 C) */
  sizes: string[];
  /** this lay's own size ratio (Change 17 B) — the ONLY size-distribution control now */
  ratio: [string, number][];
  /**
   * Change 39 Part A — the entered TOTAL pieces per colour on this lay. The size split for
   * each colour is derived from `ratio` (splitByRatio). Colourless lays hold their whole
   * lay total under the key "". Replaces the old cut-qty + colour-ratio machinery.
   */
  colourTotals: Record<string, number>;
  /** Change 39 Part B — tied bundles per colour on this lay (integer the cutter writes down). */
  bundles: Record<string, number>;
  /** Change 39 Part B — measured length of this one lay, metres. avg/pc is derived on read. */
  layerLength: string;
  byColour: Record<string, LayerFabricRow>;
  newSize: string;
};

export const emptyLayer = (sizes: string[], ratio: [string, number][]): LayerState => ({
  label: "",
  date: "",
  master: "",
  vendor: "",
  avg: "",
  rolls: "",
  sizes,
  ratio,
  colourTotals: {},
  bundles: {},
  layerLength: "",
  byColour: {},
  newSize: "",
});

/**
 * A layer's colour×size cells (Change 39 Part A).
 *
 * The floor types one TOTAL per colour; the size split for that colour comes straight from
 * the lay's own size ratio. splitByRatio already distributes the rounding remainder, so a
 * colour's cells always sum back to its entered total. Colourless lays cut one implicit
 * colour ("") whose total is the whole lay.
 */
export function deriveLayerCells(L: LayerState, colours: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const sizeRatio = L.ratio.filter(([s]) => L.sizes.includes(s));
  const colourless = colours.length === 0 || (colours.length === 1 && colours[0] === "");
  const cs = colourless ? [""] : colours;
  for (const c of cs) {
    const total = Math.max(0, Math.round(L.colourTotals[c] ?? 0));
    const split = splitByRatio(total, sizeRatio);
    for (const s of L.sizes) out.set(cellKey(s, c), split.get(s) ?? 0);
  }
  return out;
}

export const layerTotal = (cells: Map<string, number>) => [...cells.values()].reduce((a, q) => a + (q > 0 ? q : 0), 0);

/** The payload rows for one layer — only cells with qty, only sizes the lay still carries. */
export function layerCellRows(L: LayerState, cells: Map<string, number>) {
  return [...cells.entries()]
    .filter(([, q]) => q > 0)
    .map(([k, qty]) => {
      const [size, colour] = splitCellKey(k);
      return { colour, size, qty };
    })
    .filter((c) => L.sizes.includes(c.size));
}

/**
 * Change 38 Part B — the fabricByColour payload: issued + balance typed, USED derived server-side.
 * Change 39 Part B — also carries per-colour `bundles`, so a colour with bundles but no fabric
 * figures still produces a CuttingLayerColour row.
 */
export function layerFabricPayload(L: LayerState) {
  const colours = new Set<string>([...Object.keys(L.byColour ?? {}), ...Object.keys(L.bundles ?? {})]);
  const rows = [...colours]
    .map((colour) => ({
      colour,
      issued: numOrNull(L.byColour?.[colour]?.issued ?? ""),
      balance: numOrNull(L.byColour?.[colour]?.balance ?? ""),
      bundles: L.bundles?.[colour] != null && L.bundles[colour] > 0 ? Math.round(L.bundles[colour]) : null,
    }))
    .filter((r) => r.issued != null || r.balance != null || r.bundles != null);
  return rows.length ? rows : null;
}

/** Σ of one typed column across a layer's colour rows, plus the derived Used. */
export function layerFabricTotals(L: LayerState, colours: string[]) {
  const sum = (k: keyof LayerFabricRow) => {
    const v = colours.map((c) => numOrNull((L.byColour?.[c] ?? { issued: "", balance: "" })[k])).filter((x): x is number => x != null);
    return v.length ? round2(v.reduce((a, b) => a + b, 0)) : null;
  };
  const issued = sum("issued");
  const balance = sum("balance");
  const perColour = issued != null || balance != null;
  return { perColour, issued, balance, used: perColour ? round2((issued ?? 0) - (balance ?? 0)) : null };
}

const inp = "w-full rounded-md border border-border bg-surface px-1.5 py-1 t-xs tnum outline-none focus:border-primary";
const faint = "w-full rounded-md border border-border bg-surface-2 px-1.5 py-1 t-xs tnum text-faint outline-none focus:border-primary focus:bg-surface";
const ro = "rounded-md border border-border bg-surface-2 px-1.5 py-1 t-xs font-semibold tnum text-t1";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block truncate t-micro uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}

/**
 * Per-colour fabric for one lay: Issued and Balance typed, Used auto.
 *
 * Exported on its own because the saved job card (Part C) renders exactly this table in
 * read-only mode — the figures captured at entry were previously never shown back.
 */
export function LayerFabricTable({
  colours,
  rows,
  onChange,
  readOnly = false,
}: {
  colours: string[];
  rows: Record<string, LayerFabricRow>;
  onChange?: (colour: string, k: keyof LayerFabricRow, v: string) => void;
  readOnly?: boolean;
}) {
  if (colours.length === 0) return null;
  const at = (c: string) => rows?.[c] ?? { issued: "", balance: "" };
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full t-xs">
        <thead>
          <tr className="t-micro font-bold text-faint">
            <th className="px-2 py-1 text-left">Colour</th>
            <th className="px-2 py-1 text-right">Fabric issued</th>
            <th className="px-2 py-1 text-right">Balance</th>
            <th className="px-2 py-1 text-right">Used</th>
          </tr>
        </thead>
        <tbody>
          {colours.map((c) => {
            const i = numOrNull(at(c).issued);
            const b = numOrNull(at(c).balance);
            const used = i != null || b != null ? round2((i ?? 0) - (b ?? 0)) : null;
            return (
              <tr key={c || COLORLESS} className="border-t border-hairline">
                <td className="px-2 py-1 text-left font-semibold text-t1">{c || COLORLESS}</td>
                <td className="px-1 py-1">
                  {readOnly ? (
                    <div className="px-1 text-right tnum text-t1">{i != null ? num(i, 2) : "—"}</div>
                  ) : (
                    <input type="number" step="0.01" value={at(c).issued} placeholder="—" onChange={(e) => onChange?.(c, "issued", e.target.value)} className={`${inp} text-right`} />
                  )}
                </td>
                <td className="px-1 py-1">
                  {readOnly ? (
                    <div className="px-1 text-right tnum text-t1">{b != null ? num(b, 2) : "—"}</div>
                  ) : (
                    <input type="number" step="0.01" value={at(c).balance} placeholder="—" onChange={(e) => onChange?.(c, "balance", e.target.value)} className={`${inp} text-right`} />
                  )}
                </td>
                <td
                  className={`px-2 py-1 text-right font-semibold tnum ${used != null && used < 0 ? "text-danger" : "text-t1"}`}
                  title="Used = issued − balance. Negative means more was left over than was issued — check the figures."
                >
                  {used != null ? num(used, 2) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The whole body of one cutting layer. Identical for Layer 1 and every added layer.
 *
 * Change 39 Part A — the floor types one TOTAL per colour; the size split is the lay's own
 * size ratio (editable weights). No cut-qty box, no colour ratio, no manual per-cell grid —
 * cutQty is now derived = Σ colour totals. Part B adds a Bundles integer per colour and one
 * Layer length (m) for the lay, from which the measured avg m/pc is derived on read.
 *
 * Colour SELECTION stays at card level — colours are a property of the card, not of a lay —
 * so the colour list arrives as a prop; everything that varies per lay (sizes, size ratio,
 * colour totals, bundles, layer length, per-colour fabric, date/master/vendor) lives in
 * LayerState and is edited here.
 */
export function CuttingLayerGrid({
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
  /** the add-a-layer modal supplies its own date/master/vendor header */
  showIdentity?: boolean;
}) {
  const L = layer;
  const cells = deriveLayerCells(L, colours);
  const total = layerTotal(cells);
  const colourless = colours.length === 0 || (colours.length === 1 && colours[0] === "");
  const gridColours = colourless ? [""] : colours;
  const totals = layerFabricTotals(L, gridColours);
  // Change 39 Part B — measured avg = lay length ÷ pieces. Real, not the pre-cut estimate.
  const layerLen = numOrNull(L.layerLength);
  const avgMeasured = layerLen != null && total > 0 ? layerLen / total : null;
  const bundleTotal = gridColours.reduce((a, c) => a + Math.max(0, Math.round(L.bundles?.[c] ?? 0)), 0);

  const addSize = (raw: string) => {
    const s = sizeKey(raw);
    if (!s || L.sizes.includes(s)) {
      onChange({ newSize: "" });
      return;
    }
    // An added size joins as an EQUAL share of the existing curve, not a literal 1 — the
    // weights are fractions, so a 1 would hand one size the whole lay.
    const w = L.ratio.length ? L.ratio.reduce((a, [, x]) => a + x, 0) / L.ratio.length : 1;
    onChange({
      sizes: [...L.sizes, s].sort(orderSizes),
      ratio: [...L.ratio, [s, w] as [string, number]].sort((a, b) => orderSizes(a[0], b[0])),
      newSize: "",
    });
  };
  const removeSize = (s: string) =>
    onChange({
      sizes: L.sizes.filter((x) => x !== s),
      ratio: L.ratio.filter(([x]) => x !== s),
    });
  const setRatioWeight = (s: string, w: number) =>
    onChange({ ratio: L.ratio.map((row) => (row[0] === s ? ([row[0], Math.max(0, w)] as [string, number]) : row)) });
  const setColourTotal = (c: string, v: number) =>
    onChange({ colourTotals: { ...L.colourTotals, [c]: Math.max(0, Math.round(v)) } });
  const setBundles = (c: string, v: number) =>
    onChange({ bundles: { ...(L.bundles ?? {}), [c]: Math.max(0, Math.round(v)) } });
  const setFabric = (c: string, k: keyof LayerFabricRow, v: string) =>
    onChange({ byColour: { ...(L.byColour ?? {}), [c]: { ...(L.byColour?.[c] ?? { issued: "", balance: "" }), [k]: v } } });

  return (
    <>
      {/* sizes for this lay */}
      <label className="t-xs font-semibold text-t1">Cut sizing</label>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {L.sizes.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 t-xs font-semibold">
            {s}
            <button type="button" onClick={() => removeSize(s)} className="text-faint hover:text-danger"><X size={11} /></button>
          </span>
        ))}
        <input
          value={L.newSize}
          onChange={(e) => onChange({ newSize: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSize(L.newSize); } }}
          onBlur={() => addSize(L.newSize)}
          placeholder="+ size"
          className="w-16 rounded-full border border-dashed border-border px-2 py-0.5 t-xs uppercase outline-none focus:border-primary"
        />
      </div>

      {/* size ratio — the size-distribution curve for this lay (Change 39 A: the only size control) */}
      <div className="mt-2 t-micro font-semibold uppercase tracking-wide text-faint">Size ratio</div>
      <div className="mt-1 grid gap-1.5 text-center" style={{ gridTemplateColumns: `repeat(${L.sizes.length}, minmax(0, 1fr))` }}>
        {L.sizes.map((s) => {
          const colTotal = gridColours.reduce((a, c) => a + (cells.get(cellKey(s, c)) ?? 0), 0);
          return (
            <div key={s}>
              <div className="t-micro font-bold text-faint">{s}</div>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={L.ratio.find(([x]) => x === s)?.[1] ?? 0}
                onChange={(e) => setRatioWeight(s, +e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface py-1.5 text-center t-sm font-bold tnum outline-none focus:border-primary"
              />
              <div className="mt-0.5 t-micro text-faint tnum">{num(colTotal)} pc</div>
            </div>
          );
        })}
      </div>

      {/* colour quantities — the primary input (Change 39 A: one TOTAL per colour + bundles) */}
      <div className="mt-4 flex items-center justify-between">
        <label className="t-xs font-semibold text-t1">{colourless ? "Cut quantity" : "Cut quantity by colour"}</label>
        <span className="t-xs text-muted">{num(total)} pcs{bundleTotal > 0 ? ` · ${num(bundleTotal)} bundles` : ""}</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-center t-sm">
          <thead>
            <tr className="t-micro font-bold text-faint">
              <th className="px-2 py-1 text-left">{colourless ? "" : "Colour"}</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Bundles</th>
              {L.sizes.map((s) => <th key={s} className="px-1 py-1">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {gridColours.map((c) => (
              <tr key={c || COLORLESS} className="border-t border-hairline">
                <td className="px-2 py-1 text-left font-semibold text-t1">{c || COLORLESS}</td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={L.colourTotals?.[c] || ""}
                    placeholder="0"
                    onChange={(e) => setColourTotal(c, +e.target.value)}
                    className="w-20 min-w-[64px] rounded-md border border-border bg-surface py-1.5 text-right t-sm font-bold tnum outline-none focus:border-primary"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={L.bundles?.[c] || ""}
                    placeholder="—"
                    onChange={(e) => setBundles(c, +e.target.value)}
                    className="w-16 min-w-[52px] rounded-md border border-border bg-surface-2 py-1.5 text-right t-sm font-semibold tnum text-t2 outline-none focus:border-primary focus:bg-surface"
                  />
                </td>
                {L.sizes.map((s) => (
                  <td key={s} className="px-1 py-1">
                    <div className="rounded-md bg-surface py-1 t-xs font-bold tnum text-t2">{num(cells.get(cellKey(s, c)) ?? 0)}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border t-micro font-bold text-primary-ink">
              <td className="px-2 py-1 text-left">Total</td>
              <td className="px-1 py-1 text-right tnum">{num(total)}</td>
              <td className="px-1 py-1 text-right tnum">{bundleTotal > 0 ? num(bundleTotal) : "—"}</td>
              {L.sizes.map((s) => {
                const colTotal = gridColours.reduce((a, c) => a + (cells.get(cellKey(s, c)) ?? 0), 0);
                return <td key={s} className="px-1 py-1 tnum">{num(colTotal)}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* fabric maths for this lay */}
      <div className="mt-3 border-t border-border/60 pt-2.5">
        {/* Change 39 Part B — layer length + derived measured avg, beside the estimate */}
        <div className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          <Field label="layer length (m)">
            <input type="number" step="0.01" inputMode="decimal" value={L.layerLength} placeholder="—" onChange={(e) => onChange({ layerLength: e.target.value })} className={inp} />
          </Field>
          <Field label="avg m/pc (actual)">
            <div className={ro} title="Measured = layer length ÷ pieces">{avgMeasured != null ? num(avgMeasured, 3) : "—"}</div>
          </Field>
        </div>
        <div className={`grid grid-cols-3 gap-1.5 sm:grid-cols-6 ${showIdentity ? "lg:grid-cols-8" : "lg:grid-cols-5"}`}>
          <Field label="avg m/pc (est)"><input type="number" step="0.001" value={L.avg} placeholder="—" onChange={(e) => onChange({ avg: e.target.value })} className={faint} /></Field>
          <Field label="rolls"><input type="number" value={L.rolls} placeholder="—" onChange={(e) => onChange({ rolls: e.target.value })} className={faint} /></Field>
          <Field label="fabric issued">
            <div className={ro} title="Σ issued across the colour rows">{totals.issued != null ? num(totals.issued, 2) : "—"}</div>
          </Field>
          <Field label="balance">
            <div className={ro} title="Σ balance across the colour rows">{totals.balance != null ? num(totals.balance, 2) : "—"}</div>
          </Field>
          <Field label="used">
            <div className={`${ro} ${totals.used != null && totals.used < 0 ? "text-danger" : ""}`} title="Used = issued − balance">
              {totals.used != null ? num(totals.used, 2) : "—"}
            </div>
          </Field>
          {showIdentity && (
            <>
              <Field label="cut date"><input type="date" value={L.date} onChange={(e) => onChange({ date: e.target.value })} className={inp} /></Field>
              <Field label="master">
                <select value={L.master} onChange={(e) => onChange({ master: e.target.value })} className={inp}>
                  <option value="">default</option>
                  {masters.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="vendor">
                <select value={L.vendor} onChange={(e) => onChange({ vendor: e.target.value })} className={inp}>
                  <option value="">card vendor</option>
                  {vendors.map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>

        <LayerFabricTable colours={gridColours} rows={L.byColour} onChange={setFabric} />
      </div>
    </>
  );
}
