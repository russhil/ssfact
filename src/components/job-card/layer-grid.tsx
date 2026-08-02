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
 * the same controls. The Fill helper is gone: "By ratio" + Cut Qty does the same job in the
 * mechanism Layer 1 already used, and it works on every layer.
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
  /** this lay's own size ratio (Change 17 B) */
  ratio: [string, number][];
  cutMode: "ratio" | "manual";
  cutQty: string;
  /** manual per-size totals, used when cutMode === "manual" */
  sizeQty: Record<string, number>;
  /** manual per-cell qty, used when colourMode === "manual" */
  cells: Record<string, number>;
  colourMode: "ratio" | "manual";
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
  cutMode: "ratio",
  cutQty: "",
  sizeQty: {},
  cells: {},
  colourMode: "ratio",
  byColour: {},
  newSize: "",
});

/**
 * The colour ratio, resolved for EVERY colour on the card.
 *
 * ⚠️ A colour the product master has never heard of joins as an EQUAL share of the existing
 * curve, NOT weight 1. The master stores fractions (0.1667 each), so a literal 1 would hand
 * the newcomer six times everyone else's cut. add-cutting-layer.tsx used `?? 1` and so split
 * "all colours" differently from the create form for the same card — that was a bug, and this
 * is the one resolution both now use.
 */
export function resolveColourRatio(
  colours: string[],
  colourWeight: Record<string, number>,
  fromProduct: Map<string, number>
): [string, number][] {
  const known = colours.map((c) => fromProduct.get(c)).filter((w): w is number => w != null);
  const fallback = known.length ? known.reduce((a, w) => a + w, 0) / known.length : 1;
  return colours.map((c) => [c, colourWeight[c] ?? fromProduct.get(c) ?? fallback]);
}

/**
 * A layer's colour×size cells, derived the way Layer 1 has always derived them: split the
 * cut qty across sizes first, then each size across colours. Manual mode on either axis
 * short-circuits that axis to the typed numbers.
 */
export function deriveLayerCells(
  L: LayerState,
  colours: string[],
  colourRatio: [string, number][]
): Map<string, number> {
  const out = new Map<string, number>();
  const sizeTotals: Record<string, number> = {};
  if (L.cutMode === "manual") {
    for (const s of L.sizes) sizeTotals[s] = Math.max(0, Math.round(L.sizeQty[s] ?? 0));
  } else {
    const split = splitByRatio(numOrNull(L.cutQty) ?? 0, L.ratio.filter(([s]) => L.sizes.includes(s)));
    for (const s of L.sizes) sizeTotals[s] = split.get(s) ?? 0;
  }
  const colourless = colours.length === 0 || (colours.length === 1 && colours[0] === "");
  for (const s of L.sizes) {
    if (colourless) {
      out.set(cellKey(s, ""), sizeTotals[s] ?? 0);
      continue;
    }
    if (L.colourMode === "manual") {
      for (const c of colours) out.set(cellKey(s, c), Math.max(0, Math.round(L.cells[cellKey(s, c)] ?? 0)));
    } else {
      const split = splitByRatio(sizeTotals[s] ?? 0, colourRatio.filter(([c]) => colours.includes(c)));
      for (const c of colours) out.set(cellKey(s, c), split.get(c) ?? 0);
    }
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

/** Change 38 Part B — the fabricByColour payload: issued + balance typed, USED derived server-side. */
export function layerFabricPayload(L: LayerState) {
  const rows = Object.entries(L.byColour ?? {})
    .map(([colour, v]) => ({ colour, issued: numOrNull(v.issued), balance: numOrNull(v.balance) }))
    .filter((r) => r.issued != null || r.balance != null);
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

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 t-xs font-semibold transition ${
            value === v ? "bg-primary-soft text-primary-ink" : "text-t2 hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
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
 * Colour SELECTION and the colour ratio stay at card level — colours are a property of the
 * card, not of a lay — so they arrive as props; everything that genuinely varies per lay
 * (sizes, size ratio, cut qty, cells, per-colour fabric, date/master/vendor) lives in
 * LayerState and is edited here.
 */
export function CuttingLayerGrid({
  layer,
  colours,
  colourRatio,
  masters,
  vendors,
  onChange,
  showIdentity = true,
}: {
  layer: LayerState;
  colours: string[];
  colourRatio: [string, number][];
  masters: string[];
  vendors: string[];
  onChange: (patch: Partial<LayerState>) => void;
  /** the add-a-layer modal supplies its own date/master/vendor header */
  showIdentity?: boolean;
}) {
  const L = layer;
  const cells = deriveLayerCells(L, colours, colourRatio);
  const total = layerTotal(cells);
  const colourless = colours.length === 0 || (colours.length === 1 && colours[0] === "");
  const gridColours = colourless ? [""] : colours;
  const totals = layerFabricTotals(L, gridColours);

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
      // drop the column's cells too — a hidden size must never reach the payload
      cells: Object.fromEntries(Object.entries(L.cells).filter(([k]) => splitCellKey(k)[0] !== s)),
    });
  const setRatioWeight = (s: string, w: number) =>
    onChange({ ratio: L.ratio.map((row) => (row[0] === s ? ([row[0], Math.max(0, w)] as [string, number]) : row)) });
  const setCell = (s: string, c: string, qty: number) =>
    onChange({ cells: { ...L.cells, [cellKey(s, c)]: Math.max(0, Math.round(qty)) } });
  const setFabric = (c: string, k: keyof LayerFabricRow, v: string) =>
    onChange({ byColour: { ...(L.byColour ?? {}), [c]: { ...(L.byColour?.[c] ?? { issued: "", balance: "" }), [k]: v } } });

  return (
    <>
      {/* sizes for this lay */}
      <div className="flex items-center justify-between">
        <label className="t-xs font-semibold text-t1">Cut sizing</label>
        <Toggle value={L.cutMode} onChange={(v) => onChange({ cutMode: v })} options={[["ratio", "By ratio"], ["manual", "Manual"]]} />
      </div>

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

      {L.cutMode === "ratio" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="t-xs font-semibold text-t1">Cut Qty</span>
          <input
            type="number"
            value={L.cutQty}
            placeholder="0"
            onChange={(e) => onChange({ cutQty: e.target.value })}
            className="w-28 rounded-lg border border-border px-3 py-2 t-body font-semibold outline-none focus:border-primary"
          />
        </div>
      )}

      {/* per-size split / inputs */}
      <div className="mt-3 grid gap-1.5 text-center" style={{ gridTemplateColumns: `repeat(${L.sizes.length + 1}, minmax(0, 1fr))` }}>
        {L.sizes.map((s) => {
          const colTotal = gridColours.reduce((a, c) => a + (cells.get(cellKey(s, c)) ?? 0), 0);
          return (
            <div key={s}>
              <div className="t-micro font-bold text-faint">{s}</div>
              {L.cutMode === "manual" ? (
                <input
                  type="number"
                  value={L.sizeQty[s] || ""}
                  placeholder="0"
                  onChange={(e) => onChange({ sizeQty: { ...L.sizeQty, [s]: Math.max(0, +e.target.value) } })}
                  className="mt-1 w-full rounded-md border border-border bg-surface py-1.5 text-center t-sm font-bold tnum outline-none focus:border-primary"
                />
              ) : (
                <>
                  <input
                    type="number"
                    step="0.01"
                    value={L.ratio.find(([x]) => x === s)?.[1] ?? 0}
                    onChange={(e) => setRatioWeight(s, +e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface py-1.5 text-center t-sm font-bold tnum outline-none focus:border-primary"
                  />
                  <div className="mt-0.5 t-micro text-faint tnum">{num(colTotal)} pc</div>
                </>
              )}
            </div>
          );
        })}
        <div>
          <div className="t-micro font-bold text-primary-ink">Total</div>
          <div className="mt-1 rounded-md bg-primary-soft py-1.5 t-sm font-bold text-primary-ink tnum">{num(total)}</div>
        </div>
      </div>

      {/* colour×size grid */}
      {!colourless && (
        <>
          <div className="mt-4 flex items-center justify-between">
            <label className="t-xs font-semibold text-t1">Colours</label>
            <Toggle value={L.colourMode} onChange={(v) => onChange({ colourMode: v })} options={[["ratio", "By ratio"], ["manual", "Manual grid"]]} />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-center t-sm">
              <thead>
                <tr className="t-micro font-bold text-faint">
                  <th className="px-2 py-1 text-left">Colour \ Size</th>
                  {L.sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
                  <th className="px-2 py-1 text-primary-ink">Total</th>
                </tr>
              </thead>
              <tbody>
                {gridColours.map((c) => {
                  const rowTotal = L.sizes.reduce((a, s) => a + (cells.get(cellKey(s, c)) ?? 0), 0);
                  return (
                    <tr key={c || COLORLESS}>
                      <td className="px-2 py-1 text-left font-semibold text-t1">{c || COLORLESS}</td>
                      {L.sizes.map((s) => (
                        <td key={s} className="px-1 py-1">
                          {L.colourMode === "manual" ? (
                            <input
                              type="number"
                              value={L.cells[cellKey(s, c)] || ""}
                              placeholder="0"
                              onChange={(e) => setCell(s, c, +e.target.value)}
                              className="w-full min-w-[44px] rounded-md border border-border bg-surface py-1 text-center t-xs font-bold tnum outline-none focus:border-primary"
                            />
                          ) : (
                            <div className="rounded-md bg-surface py-1 t-xs font-bold tnum">{num(cells.get(cellKey(s, c)) ?? 0)}</div>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1 font-bold text-primary-ink tnum">{num(rowTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* fabric maths for this lay */}
      <div className="mt-3 border-t border-border/60 pt-2.5">
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
