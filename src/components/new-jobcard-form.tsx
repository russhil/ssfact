"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJobCard, upsertDraftJobCard, finaliseDraftJobCard } from "@/lib/actions";
import { uploadImage } from "@/lib/uploads";
import type { JobProductOption } from "@/lib/inventory";
import type { DraftForEdit } from "@/lib/jobs";
import type { OpenOrderOption } from "@/lib/production";
import { colorKey } from "@/lib/colour";
import { STAGES, STAGE_LABEL, DEFAULT_SIZE_RATIO, orderSizes, type Stage } from "@/lib/job-labels";
import { Badge } from "@/components/ui";
import { useMemoKeyboardList } from "@/components/use-keyboard-list";
import { SignatoryPicker } from "@/components/signatory-picker";
import { num, inr } from "@/lib/format";
import { Check, AlertTriangle, ArrowLeft, Plus, X, Layers, Image as ImageIcon } from "lucide-react";
// Change 38 Part D — one layer UI for every layer, and one home for the cell-key helpers
// that used to be copy-pasted into this file, add-cutting-layer and layer-actions.
import {
  COLORLESS,
  deriveLayerCells,
  emptyLayer,
  intOrNull,
  layerCellRows,
  layerFabricPayload,
  layerTotal,
  numOrNull,
  splitCellKey,
  type LayerState,
} from "@/components/job-card/layer-grid";
import { ResponsiveCuttingLayerGrid } from "@/components/job-card/layer-grid-mobile";
import { TABBAR_H } from "@/components/shell/bottom-nav";

type BomDim = "COLOR" | "SIZE" | "FLAT";
type BomRow = { trimItemId: number | null; material: string; color: string; dimension: BomDim; perPieceQty: number };

/** A layer plus the key React needs. Layer 1 is layers[0] — there is no special case. */
type Layer = LayerState & { id: number };

let layerSeq = 0;
/**
 * Change 17 B / 26 C: a new lay seeds its own size list and ratio from the card's default,
 * and owns both thereafter. A module counter rather than Date.now(), so two layers added in
 * the same millisecond can't collide on their React key.
 */
function newLayer(seed: [string, number][]): Layer {
  return {
    ...emptyLayer(seed.map(([s]) => s), seed.map(([s, w]) => [s, w] as [string, number])),
    id: ++layerSeq,
  };
}

/**
 * Change 38 Part A — turn a resumed draft into the form's INITIAL state.
 *
 * Deliberately a pure function feeding useState initialisers rather than an effect that
 * fires a dozen setStates on mount: a draft is server-provided and constant for the life of
 * the page, so there is nothing to synchronise, and doing it in an effect only buys a
 * cascade of renders (and a lint error saying so).
 */
function seedLayers(draft: DraftForEdit | null): Layer[] {
  if (!draft) return [];
  return draft.layers.map((l) => {
    // Change 39 A: rebuild the per-colour TOTALS from the stored cells (the new entry model
    // is one total per colour; the size split re-derives from the lay's own ratio).
    const colourTotals: Record<string, number> = {};
    for (const [k, q] of Object.entries(l.cells)) {
      const colour = splitCellKey(k)[1];
      colourTotals[colour] = (colourTotals[colour] ?? 0) + q;
    }
    return {
      ...emptyLayer(l.sizes, l.ratio),
      id: ++layerSeq,
      label: l.label, date: l.date, master: l.master, vendor: l.vendor,
      avg: l.avg, rolls: l.rolls,
      colourTotals,
      // Change 39 B — bundles per colour + measured lay length carried back into the draft.
      bundles: Object.fromEntries(
        l.colours.filter((c) => c.bundles != null).map((c) => [c.colour, c.bundles as number])
      ),
      layerLength: l.layerLength ?? "",
      byColour: Object.fromEntries(l.colours.map((c) => [c.colour, { issued: c.issued, balance: c.balance }])),
      newSize: "",
    };
  });
}

export function NewJobCardForm({
  products,
  vendors,
  masters,
  orders = [],
  signatories = [],
  canSeeCost = false,
  defaultProductId = null,
  defaultSi = null,
  draft = null,
}: {
  products: JobProductOption[];
  vendors: string[];
  masters: string[];
  /** Change 39 Part C — open production orders, for the "cut against" link. */
  orders?: OpenOrderOption[];
  /** Change 39 Part G1 — firm contact names for the authorised-signatory picker. */
  signatories?: string[];
  canSeeCost?: boolean;
  defaultProductId?: number | null;
  defaultSi?: string | null;
  /** Change 38 Part A — a draft being resumed. */
  draft?: DraftForEdit | null;
}) {
  const router = useRouter();
  // Change 38 Part A — the product a resumed draft was raised against.
  const draftProduct = draft?.productId ? products.find((x) => x.id === draft.productId) ?? null : null;
  const [query, setQuery] = useState(draftProduct?.styleNo ?? "");
  const [picked, setPicked] = useState<JobProductOption | null>(draftProduct);

  // made-to-order (Change 12, Part D): a one-off order with no catalogue product
  const [mto, setMto] = useState(!!draft?.customItem && !draftProduct);
  const [customItem, setCustomItem] = useState(draft?.customItem ?? "");
  const [customSku, setCustomSku] = useState(draft?.customSku ?? "");
  const [customStyle, setCustomStyle] = useState(draft?.customStyle ?? "");
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(
    draft?.vendor || (vendors.find((v) => v === "Pebble") ?? vendors.find((v) => v !== "Unassigned") ?? vendors[0] ?? "")
  );
  const [master, setMaster] = useState(draft?.master || (masters.find((m) => m.includes("Attri")) ?? masters[0] ?? ""));
  const [etd, setEtd] = useState(draft?.plannedEtd ?? "");
  const [stage, setStage] = useState<Stage>((draft?.stage as Stage) ?? "CUTTING");
  const [remark, setRemark] = useState(draft?.remark ?? "");
  const [saving, setSaving] = useState(false);

  // header additions (Change 10, Part E)
  const [needsPrint, setNeedsPrint] = useState(draft?.needsPrint ?? false);
  const [needsLaser, setNeedsLaser] = useState(draft?.needsLaser ?? false);
  const [needsEmb, setNeedsEmb] = useState(draft?.needsEmb ?? false);
  const [merchandiser, setMerchandiser] = useState(draft?.merchandiser ?? "");
  const [mrpInput, setMrpInput] = useState(draft?.mrp != null ? String(draft.mrp) : "");

  // The card's default size ratio, from the product master. It seeds each new lay and is
  // editable per lay thereafter — the card itself no longer cuts anything directly.
  const [sizeRatio, setSizeRatio] = useState<[string, number][]>(draftProduct?.sizeRatio ?? []);

  // colours are a property of the CARD, shared across every lay
  const [activeColors, setActiveColors] = useState<string[]>(draftProduct?.colors.map((c) => c.name) ?? []);

  // Change 39 Part C — the production order this card cuts against (optional link). Seeded
  // from a resumed draft; auto-preselected in pick() when a product has exactly one open order.
  const [productionOrderId, setProductionOrderId] = useState<number | null>(draft?.productionOrderId ?? null);
  const orderOptions = useMemo(
    () => (picked ? orders.filter((o) => o.productId === picked.id) : []),
    [orders, picked]
  );

  // Change 39 Part G1 — authorised signatory (firm contact name; never the login user).
  const [signatoryName, setSignatoryName] = useState<string>(draft?.signatoryName ?? "");

  // Change 38 Part D: every lay, including the first, is one of these.
  const [layers, setLayers] = useState<Layer[]>(() => seedLayers(draft));

  // Change 14 Part C: average is ONE value per job card (not per colour).
  const [cardAvg, setCardAvg] = useState("");
  // Change 16 Part A: live summary defaults to per-layer (Separate); Combined = all-layers roll-up.
  const [summaryView, setSummaryView] = useState<"separate" | "combined">("separate");
  // per-colour fabric overrides + fabric-detail plan (keyed by colourKey)
  const [colorAvg, setColorAvg] = useState<Record<string, number>>({});
  const [colorGsm, setColorGsm] = useState<Record<string, number>>({});
  const [colorWidth, setColorWidth] = useState<Record<string, number>>({});
  const [colorReqPcs, setColorReqPcs] = useState<Record<string, number>>({});
  const [colorReqMtr, setColorReqMtr] = useState<Record<string, number>>({});
  const [colorRolls, setColorRolls] = useState<Record<string, number>>({});
  const [colorImage, setColorImage] = useState<Record<string, string>>({});

  // editable trim sheet (Change 02)
  const [bomRows, setBomRows] = useState<BomRow[]>(() =>
    (draftProduct?.bom ?? []).map((b) => ({
      trimItemId: b.trimItemId,
      material: b.material,
      color: b.color ?? "",
      dimension: ((b.dimension as BomDim) ?? "FLAT"),
      perPieceQty: b.perPieceQty ?? 0,
    }))
  );

  const colors = picked?.colors ?? [];
  const gridColours = colors.length > 0 ? activeColors : [""]; // colourless products cut in one row

  /** Every lay's derived cells, in layer order. The single source of truth for all roll-ups. */
  const layerCells = useMemo(
    () => layers.map((L) => deriveLayerCells(L, gridColours)),
    [layers, gridColours]
  );

  // combined cells across ALL layers — drives the live fabric preview + trim explosion + grand total
  const combinedCells = useMemo(() => {
    const m = new Map<string, { size: string; color: string; qty: number }>();
    for (let i = 0; i < layers.length; i++) {
      for (const [k, qty] of layerCells[i] ?? new Map()) {
        if (qty <= 0) continue;
        const [size, color] = splitCellKey(k);
        // a size the user removed from this lay must never reach a roll-up
        if (!layers[i].sizes.includes(size)) continue;
        const e = m.get(k) ?? { size, color, qty: 0 };
        e.qty += qty;
        m.set(k, e);
      }
    }
    return [...m.values()];
  }, [layers, layerCells]);

  const cutQty = combinedCells.reduce((a, c) => a + c.qty, 0);

  // per-colour + per-size roll-ups (grand, across layers)
  const byColour = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of combinedCells) { const k = c.color || COLORLESS; m.set(k, (m.get(k) ?? 0) + c.qty); }
    return [...m.entries()].map(([colour, qty]) => ({ colour, qty }));
  }, [combinedCells]);
  const bySize = useMemo(() => {
    // Change 26 D: built from the cells, not from the card's size axis. Mapping over `sizes`
    // silently dropped any size a later layer introduced — its pieces counted toward cutQty
    // but never appeared in this roll-up.
    const m = new Map<string, number>();
    for (const c of combinedCells) m.set(c.size, (m.get(c.size) ?? 0) + c.qty);
    return [...m.keys()].sort(orderSizes).map((s) => ({ size: s, qty: m.get(s) ?? 0 }));
  }, [combinedCells]);

  // per-colour fabric estimate — each colour draws from that colour's stock
  const fabricRows = useMemo(() => {
    if (!picked) return [];
    const grouped = new Map<string, { display: string; qty: number }>();
    for (const r of combinedCells) {
      const disp = r.color || COLORLESS;
      const key = disp === COLORLESS ? "" : colorKey(disp);
      const e = grouped.get(key) ?? { display: disp, qty: 0 };
      e.qty += r.qty;
      grouped.set(key, e);
    }
    const defAvg = numOrNull(cardAvg) ?? picked.avgConsumption ?? null; // one avg per card (Change 14 Part C)
    return [...grouped.entries()].map(([key, { display, qty }]) => {
      const avg = defAvg;
      const required = avg != null ? Math.round(qty * avg * 100) / 100 : null;
      const available = display === COLORLESS ? picked.fabricAvailable : picked.fabricByColor[key] ?? 0;
      const enough = required != null && available != null ? available >= required : null;
      return {
        key, display, qty, avg, required, available, enough,
        gsm: colorGsm[key] ?? picked.fabricGsm ?? null,
        width: colorWidth[key] ?? picked.fabricRollWidth ?? null,
      };
    });
  }, [picked, combinedCells, cardAvg, colorGsm, colorWidth]);

  const totalRequired = fabricRows.reduce((a, r) => a + (r.required ?? 0), 0);
  const anyShort = fabricRows.some((r) => r.enough === false);

  // Change 16 Part A/B: per-layer fabric summary (used & left per colour, per layer).
  // Display-only — trim/save still use the grand combinedCells (no double-count).
  const layerSummaries = useMemo(() => {
    if (!picked) return [] as { label: string; rows: { display: string; qty: number; used: number | null; left: number | null }[] }[];
    const grandAvg = numOrNull(cardAvg) ?? picked.avgConsumption ?? null;
    const build = (label: string, cells: { color: string; qty: number }[], avg: number | null) => {
      const grouped = new Map<string, { display: string; qty: number }>();
      for (const c of cells) {
        if (c.qty <= 0) continue;
        const disp = c.color || COLORLESS;
        const key = disp === COLORLESS ? "" : colorKey(disp);
        const e = grouped.get(key) ?? { display: disp, qty: 0 };
        e.qty += c.qty;
        grouped.set(key, e);
      }
      const rows = [...grouped.entries()].map(([key, { display, qty }]) => {
        const used = avg != null ? Math.round(qty * avg * 100) / 100 : null;
        const stock = display === COLORLESS ? picked.fabricAvailable : picked.fabricByColor[key] ?? 0;
        const left = used != null && stock != null ? Math.round((stock - used) * 100) / 100 : null;
        return { display, qty, used, left };
      });
      return { label, rows };
    };
    const out: { label: string; rows: { display: string; qty: number; used: number | null; left: number | null }[] }[] = [];
    layers.forEach((L, i) => {
      const cells = [...(layerCells[i] ?? new Map())]
        .filter(([k, q]) => q > 0 && L.sizes.includes(splitCellKey(k)[0]))
        .map(([k, q]) => ({ color: splitCellKey(k)[1], qty: q }));
      if (cells.length) out.push(build(L.label.trim() || `Layer ${i + 1}`, cells, numOrNull(L.avg) ?? grandAvg));
    });
    return out;
  }, [picked, layers, layerCells, cardAvg]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.itemDesc.toLowerCase().includes(q) ||
          p.styleNo.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [query, products]);

  // keyboard nav for the product search dropdown (Change 14 Part F)
  const { activeIndex: prodActive, onKeyDown: prodKeyDown } = useMemoKeyboardList(
    open ? matches.length : 0,
    (i) => matches[i] && pick(matches[i]),
    () => setOpen(false)
  );

  // Change 40 Part D — cutByColour removed; BOM no longer explodes per-colour (flat only).
  const trimById = useMemo(() => {
    const m = new Map<number, { name: string; currentStock: number }>();
    for (const g of picked?.trimMaster ?? []) for (const it of g.items) m.set(it.id, { name: it.name, currentStock: it.currentStock });
    return m;
  }, [picked]);
  function bomRequired(r: BomRow): number {
    // Change 40 Part D — every BOM line is Flat: perPieceQty × total cutQty. The old COLOR
    // branch (explode against one colour's cut) is gone; see explodeBom in actions.ts.
    return (r.perPieceQty || 0) * cutQty;
  }
  function presetRows(p: JobProductOption): BomRow[] {
    return (p.bom ?? []).map((b) => ({
      trimItemId: b.trimItemId,
      material: b.material,
      color: b.color ?? "",
      dimension: ((b.dimension as BomDim) ?? "FLAT"),
      perPieceQty: b.perPieceQty ?? 0,
    }));
  }
  const setBomRow = (i: number, patch: Partial<BomRow>) =>
    setBomRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  function pick(p: JobProductOption) {
    setPicked(p);
    setQuery(p.styleNo);
    setOpen(false);
    setSizeRatio(p.sizeRatio);
    setColorAvg({});
    setCardAvg("");
    setColorGsm({});
    setColorWidth({});
    setColorReqPcs({});
    setColorReqMtr({});
    setColorRolls({});
    setColorImage({});
    setLayers([newLayer(p.sizeRatio)]);
    setMrpInput(p.mrp != null ? String(p.mrp) : "");
    setBomRows(presetRows(p));
    setActiveColors(p.colors.map((c) => c.name)); // default: all colors in play
    // Change 39 Part C — auto-link when exactly one open order exists for this product.
    const open = orders.filter((o) => o.productId === p.id);
    setProductionOrderId(open.length === 1 ? open[0].id : null);
  }

  // prefill from product master (Part A — "New Job Card" from a product)
  useEffect(() => {
    if (defaultProductId == null || picked || draft) return;
    const p = products.find((x) => x.id === defaultProductId);
    if (p) pick(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultProductId]);



  // made-to-order has no product to seed sizes from — start from the default size ratio.
  function enableMto() {
    setPicked(null);
    setQuery("");
    setOpen(false);
    setMto(true);
    setSizeRatio((prev) => {
      const r = prev.length ? prev : [...DEFAULT_SIZE_RATIO];
      setLayers((rows) => (rows.length ? rows : [newLayer(r)]));
      return r;
    });
  }

  function toggleColor(name: string) {
    setActiveColors((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  }

  // ── layers ──
  const addLayer = () => setLayers((rows) => [...rows, newLayer(sizeRatio)]);
  const removeLayer = (id: number) => setLayers((rows) => rows.filter((L) => L.id !== id));
  const patchLayer = (id: number, patch: Partial<LayerState>) =>
    setLayers((rows) => rows.map((L) => (L.id === id ? { ...L, ...patch } : L)));

  // build the layers payload for save
  function buildLayers() {
    const out = [];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const cells = layerCellRows(L, layerCells[i] ?? new Map());
      if (!cells.length) continue;
      const ratio = L.ratio.filter(([s]) => L.sizes.includes(s));
      out.push({
        label: L.label.trim() || `Layer ${i + 1}`,
        cutDate: L.date || null,
        cuttingMaster: L.master || null,
        vendorName: L.vendor || null,
        avgConsumption: numOrNull(L.avg),
        rolls: intOrNull(L.rolls),
        // Change 38 Part B: with colour rows the server derives these from them; the layer
        // figures below are only used by a lay entered without any per-colour fabric.
        fabricMtr: null,
        fabricBalance: null,
        fabricIssued: null,
        fabricByColour: layerFabricPayload(L),
        sizeRatio: ratio.length ? JSON.stringify(ratio) : null, // Change 17 B
        layerLength: numOrNull(L.layerLength), // Change 39 B
        cells,
      });
    }
    return out;
  }

  async function uploadColourImage(key: string, file: File) {
    try {
      const { url } = await uploadImage(file);
      setColorImage((p) => ({ ...p, [key]: url }));
    } catch (e) {
      alert("Image upload failed: " + (e as Error).message);
    }
  }

  const canSave = (!!picked || (mto && customItem.trim().length > 0)) && cutQty > 0;

  /**
   * Change 38 Part A — the payload, built once and used by both the silent draft and the
   * real save. Two builders would be two things to keep in step, and the whole guarantee
   * here is that saving a draft posts exactly what the draft was holding.
   */
  function buildPayload() {
    return {
      productId: picked?.id,
        customItem: mto ? customItem.trim() : undefined,
        customSku: mto ? customSku.trim() || undefined : undefined,
        customStyle: mto ? customStyle.trim() || undefined : undefined,
        customMrp: mto && canSeeCost ? numOrNull(mrpInput) : undefined,
        siNo: defaultSi ?? undefined,
        productionOrderId, // Change 39 Part C
        signatoryName: signatoryName.trim() || null, // Change 39 Part G1
        vendorName: vendor,
        cuttingMaster: master,
        layers: buildLayers(),
        fabricLines: fabricRows
          .filter((r) => r.display !== COLORLESS)
          .map((r) => ({
            color: r.display,
            estAvg: r.avg ?? null,
            gsm: colorGsm[r.key] ?? null,
            rollWidth: colorWidth[r.key] ?? null,
          })),
        fabricDetail: fabricRows
          .filter((r) => r.display !== COLORLESS)
          .map((r) => ({
            colour: r.display,
            reqPcs: colorReqPcs[r.key] ?? null,
            reqMtr: colorReqMtr[r.key] ?? null,
            rolls: colorRolls[r.key] ?? null,
            imageUrl: colorImage[r.key] ?? null,
          })),
        bomLines: bomRows
          .filter((r) => r.trimItemId != null || r.material.trim())
          .map((r) => ({
            trimItemId: r.trimItemId,
            material: r.material.trim() || (r.trimItemId ? trimById.get(r.trimItemId)?.name ?? "" : ""),
            color: r.color || null,
            dimension: r.dimension,
            perPieceQty: r.perPieceQty || 0,
          })),
        needsPrint,
        needsLaser,
        needsEmb,
        merchandiser: merchandiser.trim() || null,
        mrp: canSeeCost ? numOrNull(mrpInput) : null,
        remark: remark.trim() || undefined,
      stage,
      plannedEtd: etd || undefined,
    };
  }

  /**
   * A card can be drafted as soon as it knows WHAT is being made. Before that there is no
   * card to speak of — writeJobCard itself requires a product or a custom item.
   */
  const canDraft = !!picked || (mto && customItem.trim().length > 0);
  const [draftId, setDraftId] = useState<number | null>(draft?.id ?? null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
  // Once the card is finalised the component is navigating away; a late autosave firing
  // after that would try to rewrite a card that has already posted.
  const finalised = useRef(false);

  /**
   * Change 38 Part A — silent draft. Debounced 800 ms after any change, no button. A draft
   * moves no stock, writes no ledger row and takes no SI number, so this is free to run on
   * every keystroke's worth of state.
   */
  const draftSignature = JSON.stringify(buildPayload());
  useEffect(() => {
    if (!canDraft || finalised.current || saving) return;
    const t = setTimeout(async () => {
      if (finalised.current) return;
      setDraftState("saving");
      try {
        const res = await upsertDraftJobCard({ ...buildPayload(), draftId });
        if (finalised.current) return;
        setDraftId(Number(res.slug));
        setDraftState("saved");
      } catch {
        // A failed autosave must never interrupt typing — the next change retries.
        setDraftState("idle");
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSignature, canDraft, saving]);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    finalised.current = true;
    try {
      const payload = buildPayload();
      // Finalising the draft runs the posting path once and flips it ACTIVE, taking its SI
      // number here. Creating fresh is the same writer with nothing to reuse.
      const { slug } = draftId != null
        ? await finaliseDraftJobCard({ ...payload, draftId })
        : await createJobCard(payload);
      router.push(`/job-cards/${slug}`);
    } catch (e) {
      setSaving(false);
      finalised.current = false;
      alert("Could not save: " + (e as Error).message);
    }
  }

  // Change 40 — mobile wizard. On phones the long form is shown one step at a
  // time (Details → Cutting → Trims → Review) via `max-md:` gating, so DESKTOP is
  // untouched (max-md never applies at md+). State-preserving: sections are
  // hidden, never unmounted.
  const WIZARD_STEPS = ["Details", "Cutting", "Trims", "Review"];
  const [step, setStep] = useState(0);
  const lastStep = WIZARD_STEPS.length - 1;
  const stepShow = (n: number) => (step === n ? "" : "max-md:hidden");

  return (
    <div className="max-md:pb-24">
      <Link href="/job-cards" className="mb-4 inline-flex items-center gap-1.5 t-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Job Cards
      </Link>

      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="t-title font-bold tracking-tight">New Job Card</h1>
          <p className="mt-0.5 t-sm text-muted">
            {defaultSi ? `Adding split / re-cut under ${defaultSi}` : "Auto-assigned SI"} · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Change 38 Part A — the card is already held as a draft; say so, so it is clear
              nothing is lost by walking away, and clear that nothing has posted either. */}
          {draftId != null && (
            <span className="flex items-center gap-1.5 t-xs text-muted">
              <Badge tone="warn">Draft</Badge>
              {draftState === "saving" ? "saving…" : "held · nothing posted yet"}
            </span>
          )}
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="rounded-lg bg-primary px-4 py-2 t-body font-semibold text-accent-on shadow-sm transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Job Card"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* form */}
        <div className={`min-w-0 rounded-card border border-border bg-surface p-5 ${step === lastStep ? "max-md:hidden" : ""}`}>
          <div className={stepShow(0)}>
          <h3 className="mb-4 t-xs font-bold uppercase tracking-wide text-muted">Order details</h3>

          {/* product autocomplete (hidden in made-to-order mode) */}
          {!mto && (
            <div className="relative mb-3.5">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block t-xs font-semibold text-t1">
                  Product
                </label>
                <button type="button" onClick={enableMto} className="t-xs font-semibold text-primary-ink hover:underline">
                  Log made-to-order →
                </button>
              </div>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicked(null);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={prodKeyDown}
                placeholder="e.g. TP-TRUMP"
                className="w-full rounded-lg border border-primary px-3 py-2.5 t-body font-semibold outline-none ring-2 ring-accent/15"
              />
              {open && matches.length > 0 && (
                <div className="absolute left-0 right-0 top-[68px] z-10 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                  {matches.map((m, i) => (
                    <button
                      key={m.id}
                      onClick={() => pick(m)}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left t-sm hover:bg-primary-soft ${i === prodActive ? "bg-primary-soft" : ""}`}
                    >
                      <span>
                        <span className="font-bold">{m.styleNo}</span>
                        <span className="ml-2 text-faint">{m.itemDesc}</span>
                      </span>
                      {canSeeCost && <span className="font-bold text-ok">{inr(m.mrp)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* made-to-order free-text item (Change 12, Part D) */}
          {mto && (
            <div className="mb-3.5 rounded-lg border border-warn/30 bg-warn-soft p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="t-xs font-bold uppercase tracking-wide text-warn">Made-to-order item</span>
                <button type="button" onClick={() => { setMto(false); setCustomItem(""); setCustomSku(""); setCustomStyle(""); }} className="t-xs font-semibold text-primary-ink hover:underline">
                  ← Pick a catalogue product
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="t-xs font-semibold text-t1">Item <span className="text-danger">*</span></span>
                  <input value={customItem} onChange={(e) => setCustomItem(e.target.value)} placeholder="e.g. JHARKHAND TRACKSUIT" className="rounded-lg border border-border px-3 py-2 t-body font-semibold outline-none focus:border-primary" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="t-xs font-semibold text-t1">SKU / code</span>
                  <input value={customSku} onChange={(e) => setCustomSku(e.target.value)} placeholder="ORDER / TBC" className="rounded-lg border border-border px-3 py-2 t-body outline-none focus:border-primary" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="t-xs font-semibold text-t1">Style no</span>
                  <input value={customStyle} onChange={(e) => setCustomStyle(e.target.value)} placeholder="#1202" className="rounded-lg border border-border px-3 py-2 t-body outline-none focus:border-primary" />
                </label>
              </div>
            </div>
          )}

          {/* autofilled fields */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="Item Description" value={picked?.itemDesc ?? (mto ? customItem : "")} auto={!!picked} />
            <Field label="Fabric" value={picked?.fabricName ?? ""} auto={!!picked} />
            <Field
              label="Avg Consumption"
              value={picked?.avgConsumption ? `${picked.avgConsumption} ${picked.unit.toLowerCase()}/pc` : picked ? "not set" : ""}
              auto={!!picked}
            />
            {canSeeCost ? (
              <div>
                <label className="mb-1.5 block t-xs font-semibold text-t1">MRP <span className="font-normal text-faint">(owner)</span></label>
                <input type="number" value={mrpInput} onChange={(e) => setMrpInput(e.target.value)} placeholder="—" className="w-full rounded-lg border border-border px-3 py-2.5 t-body font-semibold outline-none focus:border-primary" />
              </div>
            ) : (
              <div />
            )}
          </div>

          {/* manual fields */}
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Vendor</label>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 t-body outline-none focus:border-primary">
                {vendors.map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Cutting Master <span className="font-normal text-faint">(default)</span></label>
              <select value={master} onChange={(e) => setMaster(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 t-body outline-none focus:border-primary">
                {masters.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Merchandiser</label>
              <input value={merchandiser} onChange={(e) => setMerchandiser(e.target.value)} placeholder="e.g. Jyotika" className="w-full rounded-lg border border-border px-3 py-2.5 t-body outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Planned ETD</label>
              <input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 t-body outline-none focus:border-primary" />
            </div>
            {/* Change 39 Part C — the production order this card cuts against (auto-linked when unambiguous) */}
            {orderOptions.length > 0 && (
              <div className="col-span-2">
                <label className="mb-1.5 block t-xs font-semibold text-t1">Production order <span className="font-normal text-faint">(optional)</span></label>
                <select
                  value={productionOrderId ?? ""}
                  onChange={(e) => setProductionOrderId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-lg border border-border px-3 py-2.5 t-body outline-none focus:border-primary"
                >
                  <option value="">— none —</option>
                  {orderOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.orderNo} · target {num(o.targetQty)}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Change 39 Part G1 — authorised signatory (firm contact, name only). */}
            <div className="col-span-2">
              <label className="mb-1.5 block t-xs font-semibold text-t1">Authorised signatory <span className="font-normal text-faint">(not the cutting master)</span></label>
              <SignatoryPicker value={signatoryName} options={signatories} onChange={setSignatoryName} />
            </div>
          </div>

          {/* process flags + stage */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="t-xs font-semibold text-t1">Process:</span>
            <FlagToggle label="PRINT" on={needsPrint} onToggle={() => setNeedsPrint((v) => !v)} />
            <FlagToggle label="LASER" on={needsLaser} onToggle={() => setNeedsLaser((v) => !v)} />
            <FlagToggle label="EMB" on={needsEmb} onToggle={() => setNeedsEmb((v) => !v)} />
            <span className="ml-auto flex rounded-lg border border-border p-0.5">
              {STAGES.map((s) => (
                <button key={s} type="button" onClick={() => setStage(s)} className={`rounded-md px-2 py-1 t-xs font-semibold transition ${stage === s ? "bg-primary text-accent-on shadow-sm" : "text-t2 hover:text-ink"}`}>
                  {STAGE_LABEL[s]}
                </button>
              ))}
            </span>
          </div>

          {/* remark (optional — fast capture) */}
          <div className="mt-2.5">
            <label className="mb-1.5 block t-xs font-semibold text-t1">Remark <span className="font-normal text-faint">(optional)</span></label>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. urgent, colour pending from party…" className="w-full rounded-lg border border-border px-3 py-2 t-body outline-none focus:border-primary" />
          </div>
          </div>{/* end wizard step 0 (Details) */}

          {picked && (
            <>
            <div className={stepShow(1)}>
              {/* ── colours: a property of the CARD, shared by every lay ── */}
              {colors.length > 0 && (
                <div className="mt-5 rounded-xl border border-border bg-surface-2 p-3.5">
                  <label className="t-xs font-semibold text-t1">Colours</label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {colors.map((c) => {
                      const on = activeColors.includes(c.name);
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => toggleColor(c.name)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 t-xs font-semibold transition ${
                            on ? "border-primary bg-primary-soft text-primary-ink" : "border-border text-t2 hover:text-ink"
                          }`}
                        >
                          {c.hex && <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: c.hex }} />}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Change 38 Part D: every lay, including the first, renders the same grid ── */}
              {layers.map((L, idx) => (
                <div key={L.id} className="mt-3 rounded-xl border border-border bg-surface-2 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 t-xs font-bold uppercase tracking-wide text-primary-ink">
                      <Layers size={13} /> Layer {idx + 1}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="t-xs text-muted">{num(layerTotal(layerCells[idx] ?? new Map()))} pcs</span>
                      {layers.length > 1 && (
                        <button type="button" onClick={() => removeLayer(L.id)} className="inline-flex items-center gap-1 t-xs font-semibold text-faint hover:text-danger">
                          <X size={12} /> remove
                        </button>
                      )}
                    </span>
                  </div>

                  <ResponsiveCuttingLayerGrid
                    layer={L}
                    colours={gridColours}
                    masters={masters}
                    vendors={vendors}
                    onChange={(patch) => patchLayer(L.id, patch)}
                  />
                </div>
              ))}

              <button type="button" onClick={addLayer} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 t-sm font-semibold text-primary-ink hover:bg-primary-soft">
                <Plus size={13} /> Add layer
              </button>
              </div>{/* end wizard step 1 (Cutting) */}

              {/* editable trim sheet (BOM) */}
              <div className={stepShow(2)}>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="t-xs font-bold uppercase tracking-wide text-muted">Trim sheet · ×{num(cutQty)} pcs</h4>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setBomRows(presetRows(picked))} className="rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2">
                      Load preset
                    </button>
                    <button type="button" onClick={() => setBomRows((r) => [...r, { trimItemId: null, material: "", color: "", dimension: "FLAT", perPieceQty: 0 }])} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2">
                      <Plus size={12} /> Add row
                    </button>
                  </div>
                </div>
                {bomRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-3 text-center t-xs text-faint">No trims</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full t-sm">
                      <thead>
                        <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                          <th className="px-2 py-2 font-semibold">Trim (from master)</th>
                          <th className="px-2 py-2 font-semibold">Colour</th>
                          <th className="px-2 py-2 text-right font-semibold">Per pc</th>
                          <th className="px-2 py-2 text-right font-semibold">Required</th>
                          <th className="px-2 py-2 text-right font-semibold">In store</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomRows.map((r, i) => {
                          const required = bomRequired(r);
                          const stock = r.trimItemId != null ? trimById.get(r.trimItemId)?.currentStock ?? null : null;
                          const short = stock != null && required > stock;
                          return (
                            <tr key={i} className="border-b border-hairline last:border-0">
                              <td className="px-2 py-1">
                                <select
                                  value={r.trimItemId ?? ""}
                                  onChange={(e) => {
                                    const id = e.target.value ? +e.target.value : null;
                                    setBomRow(i, { trimItemId: id, material: id ? trimById.get(id)?.name ?? r.material : r.material });
                                  }}
                                  className="w-full min-w-[150px] rounded-md border border-border bg-surface px-1.5 py-1 t-xs outline-none focus:border-primary"
                                >
                                  <option value="">{r.material || "— pick trim —"}</option>
                                  {(picked.trimMaster ?? []).map((g) => (
                                    <optgroup key={g.group} label={g.group}>
                                      {g.items.map((it) => (
                                        <option key={it.id} value={it.id}>{it.name} ({num(it.currentStock)})</option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </td>
                              {/* Change 40 Part D — "Applies to" removed; every line is Flat. */}
                              <td className="px-2 py-1">
                                <input value={r.color} onChange={(e) => setBomRow(i, { color: e.target.value })} placeholder="—" className="w-20 rounded-md border border-border px-1.5 py-1 t-xs outline-none focus:border-primary" />
                              </td>
                              <td className="px-1 py-1">
                                <input type="number" step="0.001" value={r.perPieceQty || ""} placeholder="0" onChange={(e) => setBomRow(i, { perPieceQty: +e.target.value })} className="w-16 rounded-md border border-border px-1.5 py-1 text-right t-xs tnum outline-none focus:border-primary" />
                              </td>
                              <td className={`px-2 py-1 text-right font-bold tnum ${short ? "text-danger" : ""}`}>{num(required)}</td>
                              <td className="px-2 py-1 text-right">
                                {stock != null ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span className={`tnum ${short ? "text-danger font-semibold" : "text-t2"}`}>{num(stock)}</span>
                                    {short && <Badge tone="danger">Short</Badge>}
                                  </span>
                                ) : (
                                  <span className="t-micro text-faint">untracked</span>
                                )}
                              </td>
                              <td className="px-1 py-1 text-right">
                                <button type="button" onClick={() => setBomRows((rows) => rows.filter((_, idx) => idx !== i))} className="text-faint hover:text-danger"><X size={13} /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {bomRows.some((r) => { const s = r.trimItemId != null ? trimById.get(r.trimItemId)?.currentStock ?? null : null; return s != null && bomRequired(r) > s; }) && (
                  <p className="mt-1.5 t-xs text-danger">Some trims are short of stock.</p>
                )}
              </div>
              </div>{/* end wizard step 2 (Trims) */}
            </>
          )}
        </div>

        {/* live calc panel */}
        <div className={`rounded-card panel-invert p-5 ${step !== lastStep ? "max-md:hidden" : ""}`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="t-xs font-bold uppercase tracking-wide text-t3">Live summary · {num(cutQty)} pcs</h3>
            {picked && (
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border border-border p-0.5 t-micro font-semibold">
                  {(["separate", "combined"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setSummaryView(v)} className={`rounded px-2 py-0.5 capitalize ${summaryView === v ? "bg-elevated text-t1" : "text-t2 hover:text-t1"}`}>{v}</button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 t-micro text-t2">
                  avg {picked.unit.toLowerCase()}/pc
                  <input type="number" step="0.001" value={cardAvg} placeholder={picked.avgConsumption != null ? String(picked.avgConsumption) : "—"} onChange={(e) => setCardAvg(e.target.value)} className="w-16 rounded-md border border-hairline bg-surface-2 px-1.5 py-1 text-center t-xs tnum text-t1 outline-none focus:border-accent" />
                </label>
              </div>
            )}
          </div>

          {!picked ? (
            <div className="flex h-56 flex-col items-center justify-center text-center t-sm text-t3">
              Select a product.
            </div>
          ) : fabricRows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center t-sm text-t3">
              Enter cut quantities.
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between border-b border-hairline pb-2.5">
                <span className="t-body text-t2">Total fabric required</span>
                <span className="t-stat font-extrabold text-t1 tnum">
                  {num(totalRequired, 0)} <span className="t-body">{picked.unit.toLowerCase()}</span>
                </span>
              </div>

              {/* per-size roll-up */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {bySize.filter((b) => b.qty > 0).map((b) => (
                  <span key={b.size} className="rounded-md bg-surface-2 px-1.5 py-0.5 t-micro text-t1"><b className="text-t1">{b.size}</b> {num(b.qty)}</span>
                ))}
              </div>

              {/* Change 16 Part A/B: SEPARATE view = one block per layer, used & left per colour */}
              {summaryView === "separate" && (
                <div className="mt-3 max-h-[420px] space-y-2.5 overflow-y-auto pr-0.5">
                  {layerSummaries.map((L, i) => (
                    <div key={i} className="rounded-lg border border-hairline bg-surface-2 p-2.5">
                      <div className="mb-1.5 t-xs font-bold uppercase tracking-wide text-t2">{L.label}</div>
                      <div className="overflow-x-auto">
                        <table className="w-full t-xs">
                          <thead>
                            <tr className="text-left t-micro uppercase tracking-wide text-t3">
                              <th className="py-0.5">Colour</th>
                              <th className="py-0.5 text-right">Cut</th>
                              <th className="py-0.5 text-right">Used {picked.unit.toLowerCase()}</th>
                              <th className="py-0.5 text-right">Left</th>
                            </tr>
                          </thead>
                          <tbody>
                            {L.rows.map((r, ri) => (
                              <tr key={ri} className="border-t border-hairline">
                                <td className="py-1 font-semibold text-t1">{r.display}</td>
                                <td className="py-1 text-right tnum text-t1">{num(r.qty)}</td>
                                <td className="py-1 text-right tnum text-t1">{r.used != null ? num(r.used) : "—"}</td>
                                <td className={`py-1 text-right tnum font-semibold ${r.left != null && r.left < 0 ? "text-danger" : "text-ok"}`}>{r.left != null ? num(r.left) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* COMBINED view = all-layers per-colour cards + fabric-detail plan inputs */}
              {summaryView === "combined" && (
              <div className="mt-3 max-h-[420px] space-y-2.5 overflow-y-auto pr-0.5">
                {fabricRows.map((r) => {
                  const usedAfter =
                    r.required != null && r.available != null && r.available > 0 ? r.required / r.available : null;
                  return (
                    <div key={r.key} className="rounded-lg border border-hairline bg-surface-2 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="t-sm font-bold text-t1">{r.display}</span>
                        <span className="t-xs text-t2">{num(r.qty)} pc</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <MiniInput label="gsm" value={colorGsm[r.key]} placeholder={picked.fabricGsm ?? undefined} onChange={(v) => setColorGsm((p) => upd(p, r.key, v))} />
                        <MiniInput label="width" value={colorWidth[r.key]} placeholder={picked.fabricRollWidth ?? undefined} onChange={(v) => setColorWidth((p) => upd(p, r.key, v))} />
                      </div>
                      {/* fabric-detail plan (Part F) */}
                      <div className="mt-1.5 grid grid-cols-2 items-end gap-1.5 sm:grid-cols-4">
                        <MiniInput label="req pcs" value={colorReqPcs[r.key]} placeholder={r.qty} onChange={(v) => setColorReqPcs((p) => upd(p, r.key, v))} />
                        <MiniInput label="req mtr" value={colorReqMtr[r.key]} placeholder={r.required ?? undefined} onChange={(v) => setColorReqMtr((p) => upd(p, r.key, v))} />
                        <MiniInput label="rolls" value={colorRolls[r.key]} onChange={(v) => setColorRolls((p) => upd(p, r.key, v))} />
                        <label className="block cursor-pointer">
                          <span className="mb-0.5 block truncate t-micro uppercase tracking-wide text-t3">swatch</span>
                          <span className="flex h-[26px] items-center justify-center gap-1 rounded-md border border-border bg-surface-2 t-micro font-semibold text-t1 hover:bg-elevated">
                            {colorImage[r.key] ? <Check size={12} className="text-ok" /> : <ImageIcon size={12} />}
                            {colorImage[r.key] ? "set" : "add"}
                          </span>
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadColourImage(r.key, f); }} />
                        </label>
                      </div>
                      <div className="mt-2 flex items-center justify-between t-xs">
                        <span className="text-t2">
                          need <b className="text-t1 tnum">{r.required != null ? num(r.required) : "—"}</b>
                          {" · "}stock <b className="tnum">{r.available != null ? num(r.available) : "—"}</b>
                        </span>
                        {r.enough == null ? (
                          <span className="text-t3">—</span>
                        ) : r.enough ? (
                          <span className="flex items-center gap-1 font-bold text-ok"><Check size={13} /> ok</span>
                        ) : (
                          <span className="flex items-center gap-1 font-bold text-danger"><AlertTriangle size={13} /> short</span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={`h-full rounded-full ${r.enough === false ? "bg-danger" : "bg-ok"}`}
                          style={{ width: `${Math.min(100, (usedAfter ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 t-body">
                <span className="text-t2">Stock check</span>
                {anyShort ? (
                  <span className="flex items-center gap-1.5 font-bold text-danger"><AlertTriangle size={15} /> Some colours short — raise indent</span>
                ) : (
                  <span className="flex items-center gap-1.5 font-bold text-ok"><Check size={15} /> All colours covered</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* mobile wizard nav — sits above the bottom tab bar */}
      <div
        className="fixed inset-x-0 z-40 flex items-center gap-3 border-t border-hairline bg-surface/95 px-4 py-2.5 backdrop-blur md:hidden"
        style={{ bottom: `calc(${TABBAR_H}px + env(safe-area-inset-bottom))` }}
      >
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-lg px-3 py-2 t-sm font-semibold text-t2 active:scale-[0.97] disabled:opacity-40"
        >
          Back
        </button>
        <span className="min-w-0 truncate t-xs font-semibold text-t3">
          Step {step + 1}/{WIZARD_STEPS.length} · {WIZARD_STEPS[step]}
        </span>
        {step < lastStep ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(lastStep, s + 1))}
            className="ml-auto rounded-lg bg-accent px-5 py-2 t-sm font-semibold text-accent-on active:scale-[0.97]"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={!canSave || saving}
            className="ml-auto rounded-lg bg-accent px-5 py-2 t-sm font-semibold text-accent-on active:scale-[0.97] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </div>
  );
}



function FlagToggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border px-2.5 py-1 t-xs font-bold transition ${
        on ? "border-primary bg-primary text-accent-on" : "border-border bg-surface text-t3 line-through decoration-t3"
      }`}
    >
      {label}
    </button>
  );
}


function Field({ label, value, auto }: { label: string; value: string; auto: boolean }) {
  return (
    <div className="relative">
      <label className="mb-1.5 block t-xs font-semibold text-t1">{label}</label>
      <input
        readOnly
        value={value}
        placeholder="—"
        className={`w-full rounded-lg border px-3 py-2.5 t-body font-semibold outline-none ${
          auto ? "border-accent-soft bg-primary-soft" : "border-border bg-surface-2 text-faint"
        }`}
      />
      {auto && (
        <span className="absolute right-2.5 top-[31px] rounded-full bg-surface px-1.5 py-0.5 t-micro font-bold text-primary-ink">auto</span>
      )}
    </div>
  );
}

// Set/clear a per-colour override; clearing reverts to the inherited default.
function upd(rec: Record<string, number>, key: string, v: number | null): Record<string, number> {
  const next = { ...rec };
  if (v == null || Number.isNaN(v)) delete next[key];
  else next[key] = v;
  return next;
}

function MiniInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block truncate t-micro uppercase tracking-wide text-t3">{label}</span>
      <input
        type="number"
        step="0.01"
        value={value ?? ""}
        placeholder={placeholder != null ? String(placeholder) : "—"}
        onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value)}
        className="w-full rounded-md border border-border bg-surface-2 px-1.5 py-1 text-center t-xs font-semibold text-t1 tnum outline-none placeholder:text-t3 focus:border-accent"
      />
    </label>
  );
}
