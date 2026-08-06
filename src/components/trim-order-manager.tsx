"use client";

import { inputClass } from "@/components/ui";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTrimOrder, createTrimQuick, updateTrimOrder, deleteTrimOrder, draftChallanFromTrimOrder, generateTrimPO, voidChallan } from "@/lib/actions";
import { Card, Badge, MobileCardList, SortHeader, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { num, inr } from "@/lib/format";
import { orderFlag } from "@/lib/order-flags";
import { GeneratePoButton, type BuyerOption } from "@/components/generate-po";
// Change 38 Part H — attach the sample photo right here, not only on the PO document.
import { ImageUploader } from "@/components/image-uploader";
import { Plus, X, Check, FileText, Truck, Pencil, Trash2, Undo2 } from "lucide-react";

/**
 * Change 18 Part B — the trim mirror of FabricOrderManager.
 *
 * Deliberately NOT a colour-line-first form: most trims (cartons, polybags, tags) are flat,
 * so quantity is the primary input and the colour/size split is an optional extra for the
 * ones that need it (buttons in 3 colours, tags in 2 sizes).
 */

type SplitLine = { colour: string; size: string; qty: number };
type ChallanLink = { id: number; challanNo: string | null; status: string };
type Order = {
  id: number; trim: string; trimItemId: number; supplier: string | null;
  supplierId: number | null; remarks: string | null;
  lines: { colour: string | null; size: string | null; qty: number }[];
  totalQty: number; unit: string | null; rate: number | null; status: string;
  expectedDate: Date | string | null; receivedDate: Date | string | null;
  poNumber: string | null; poStage: string; challans: ChallanLink[];
  // Change 22 Part A: Σ locked challan line qty — what has actually arrived.
  receivedQty: number;
  // Change 38 Part H — photos attached to this order.
  images: { id: number; url: string; thumbUrl: string | null; caption: string | null }[];
};
type Pick = { id: number; name: string };
type TrimPick = { id: number; name: string; unit: string | null; stock: number; rate: number | null };

// Change 38 Part G — sentinel for "Add new trim…", mirroring the fabric-order form.
const ADD = "__add__";

const STATUS_TONE: Record<string, "primary" | "warn" | "ok" | "default" | "danger"> = {
  PLANNING: "default", SAMPLE_PENDING: "warn", ORDER_PLACED: "primary", RECEIVED: "ok", DISCARDED: "danger",
};
const STAGE_TONE: Record<string, "default" | "primary" | "ok"> = { Draft: "default", "PO Generated": "primary", Sent: "ok" };

export function TrimOrderManager({
  orders, trims, suppliers, colours, units, buyers,
}: {
  orders: Order[]; trims: TrimPick[]; suppliers: Pick[]; colours: string[]; units: string[];
  // Change 25 G.3 / K.2 — issued from which firm and at what GST %.
  // Change 38 Part F — the signatory now comes from that firm's own contacts.
  buyers: BuyerOption[];
}) {
  const router = useRouter();
  const [trimId, setTrimId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [expected, setExpected] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [rate, setRate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [splitOpen, setSplitOpen] = useState(false);
  const [split, setSplit] = useState<SplitLine[]>([{ colour: "", size: "", qty: 0 }]);
  const [busy, setBusy] = useState(false);
  // Change 20: the same form doubles as the edit form for an unlocked order.
  const [editingId, setEditingId] = useState<number | null>(null);
  // Change 38 Part H — the order the photo uploader is pointed at: the one being edited,
  // or the one just created. ImageUploader attaches on file-drop and needs a persisted row.
  const [attachId, setAttachId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Change 38 Part G — invent a trim mid-order, the same way the fabric form does.
  const [trimList, setTrimList] = useState<TrimPick[]>(trims);
  const [addTrim, setAddTrim] = useState(false);
  const [trimDraft, setTrimDraft] = useState("");

  const trim = useMemo(() => trimList.find((t) => t.id === +trimId), [trimList, trimId]);

  function pickTrim(v: string) {
    setTrimId(v);
    const t = trimList.find((x) => x.id === +v);
    if (t?.unit) setUnit(t.unit);
  }

  async function confirmTrim() {
    if (!trimDraft.trim()) { setAddTrim(false); return; }
    setBusy(true);
    try {
      // Carries supplier + unit + rate up to the new master, as createFabricQuick does.
      const t = await createTrimQuick({
        name: trimDraft,
        unit: unit || null,
        supplierId: supplierId ? +supplierId : null,
        rate: rate ? +rate : null,
      });
      const pick: TrimPick = { id: t.id, name: t.name, unit: t.unit ?? unit ?? null, stock: 0, rate: rate ? +rate : null };
      setTrimList((p) => (p.some((x) => x.id === t.id) ? p : [...p, pick].sort((a, b) => a.name.localeCompare(b.name))));
      setTrimId(String(t.id));
      if (t.unit) setUnit(t.unit);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAddTrim(false); setTrimDraft(""); setBusy(false);
    }
  }

  // A split row is "filled" once it has a qty; colour/size are both optional labels.
  const filledSplit = split.filter((l) => l.qty > 0);
  const splitTotal = filledSplit.reduce((a, l) => a + l.qty, 0);
  const effectiveQty = splitOpen && filledSplit.length > 0 ? splitTotal : +qty || 0;
  const totalValue = rate ? effectiveQty * +rate : null;

  function setSplitRow(i: number, patch: Partial<SplitLine>) {
    setSplit((rows) => {
      const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      if (last && last.qty > 0) next.push({ colour: "", size: "", qty: 0 });
      return next;
    });
  }
  const removeSplitRow = (i: number) =>
    setSplit((rows) => (rows.length <= 1 ? [{ colour: "", size: "", qty: 0 }] : rows.filter((_, idx) => idx !== i)));

  function resetForm() {
    setEditingId(null);
    setTrimId(""); setSupplierId(""); setExpected(""); setQty(""); setUnit(""); setRate(""); setRemarks("");
    setSplitOpen(false); setSplit([{ colour: "", size: "", qty: 0 }]);
    setAttachId(null);
  }

  /**
   * The split lines. Always an array, never undefined: updateTrimOrder's body is
   * `if (input.lines) { … deleteMany … }`, so passing undefined would skip the rewrite
   * and leave stale split rows attached to an order the user just made flat.
   */
  const splitPayload = () =>
    splitOpen ? filledSplit.map((l) => ({ colour: l.colour || null, size: l.size || null, qty: l.qty })) : [];

  /** Change 38 Part A — one payload for both the silent draft and the placed order. */
  function orderPayload() {
    return {
      trimItemId: +trimId,
      supplierId: supplierId ? +supplierId : null,
      qty: effectiveQty,
      unit: unit || null,
      rate: rate ? +rate : null,
      expectedDate: expected || null,
      remarks: remarks.trim() || null,
      lines: splitPayload(),
    };
  }

  /**
   * Change 38 Part A — silent draft, debounced 800 ms. A DRAFT trim order is inert, so a
   * half-typed one costs nothing and survives. Only for a NEW order: editing a placed one
   * must not quietly revert it to a draft.
   */
  const draftSig = trimId ? JSON.stringify(orderPayload()) : "";
  useEffect(() => {
    if (!trimId || editingId || busy) return;
    const t = setTimeout(async () => {
      try {
        const res = await createTrimOrder({ ...orderPayload(), draft: true, draftId: attachId });
        setAttachId(res.id);
      } catch {
        // never interrupt typing; the next change retries
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSig, editingId]);

  async function create() {
    if (!trimId || effectiveQty <= 0) return;
    setBusy(true);
    try {
      const created = await createTrimOrder({ ...orderPayload(), draftId: attachId });
      resetForm();
      // Change 38 Part H — createTrimOrder already returned its id; the form used to throw
      // it away. Keep it so the photo uploader can appear on what was just saved.
      setAttachId(created.id);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally { setBusy(false); }
  }

  function startEdit(o: Order) {
    setEditingId(o.id);
    setAttachId(o.id);
    // setTrimId directly, not pickTrim() — that would overwrite the order's own unit
    // with the trim master's default.
    setTrimId(String(o.trimItemId));
    setUnit(o.unit ?? "");
    setSupplierId(o.supplierId ? String(o.supplierId) : "");
    setExpected(dateInput(o.expectedDate));
    setQty(String(o.totalQty));
    setRate(o.rate != null ? String(o.rate) : "");
    setRemarks(o.remarks ?? "");
    const hasSplit = o.lines.length > 0;
    setSplitOpen(hasSplit);
    setSplit(hasSplit
      ? [...o.lines.map((l) => ({ colour: l.colour ?? "", size: l.size ?? "", qty: l.qty })), { colour: "", size: "", qty: 0 }]
      : [{ colour: "", size: "", qty: 0 }]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    if (!editingId || effectiveQty <= 0) return;
    setBusy(true);
    try {
      await updateTrimOrder({
        id: editingId,
        supplierId: supplierId ? +supplierId : null,
        qty: effectiveQty,
        unit: unit || null,
        rate: rate ? +rate : null,
        expectedDate: expected || null,
        remarks: remarks.trim() || null,
        lines: splitPayload(),
      });
      resetForm();
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally { setBusy(false); }
  }

  async function remove(o: Order) {
    if (!confirm(`Delete the ${o.trim} order (${num(o.totalQty)} ${(o.unit ?? "").toLowerCase()})? This cannot be undone.`)) return;
    if (editingId === o.id) resetForm();
    await act(() => deleteTrimOrder({ id: o.id }));
  }

  // Mirrors the server guards in deleteTrimOrder / updateTrimOrder.
  const canEdit = (o: Order) => !o.poNumber && !o.receivedDate;
  const canDelete = (o: Order) => canEdit(o) && o.challans.length === 0;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); router.refresh(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }

  /**
   * Receiving is logging an inward challan — locking it is what lands the stock.
   * Change 22 Part A: the "already received, log another?" confirm is gone — a RECEIVED
   * order no longer offers this as its primary action, so getting here is a deliberate act.
   */
  async function logInward(o: Order) {
    setBusy(true);
    try {
      const { id } = await draftChallanFromTrimOrder({ id: o.id });
      router.push(`/challan-doc/${id}`);
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  }

  /** Change 22 Part A: reverse a receipt — voidChallan reverses the ledger and drops the
   *  order back to ORDER_PLACED when no other locked challan holds it received. */
  async function reverseReceipt(c: ChallanLink) {
    if (!confirm(`Reverse ${c.challanNo ?? `challan #${c.id}`} and take this stock back out?`)) return;
    await act(() => voidChallan({ id: c.id }));
  }

  // Change 23 Part C — the order list's own view state.
  const supplierNames = useMemo(
    () => [...new Set(orders.map((o) => o.supplier).filter((x): x is string => !!x))].sort(),
    [orders]
  );
  const filters: FilterDef<Order>[] = useMemo(
    () => [
      {
        key: "status",
        label: "statuses",
        options: ["PLANNING", "SAMPLE_PENDING", "ORDER_PLACED", "RECEIVED", "DISCARDED"].map((v) => ({ value: v, label: v.replace("_", " ") })),
        match: (o, v) => o.status === v,
      },
      {
        key: "stage",
        label: "PO stages",
        options: ["Draft", "PO Generated", "Sent"].map((v) => ({ value: v, label: v })),
        match: (o, v) => o.poStage === v,
      },
      {
        key: "supplier",
        label: "suppliers",
        options: supplierNames.map((n) => ({ value: n, label: n })),
        match: (o, v) => o.supplier === v,
      },
      {
        key: "delivery",
        label: "deliveries",
        options: [
          { value: "pending", label: "Pending delivery" },
          { value: "received", label: "Fully received" },
          { value: "short", label: "Short delivered" },
        ],
        match: (o, v) =>
          v === "received" ? o.receivedQty >= o.totalQty && o.receivedQty > 0
          : v === "short" ? o.receivedQty > 0 && o.receivedQty < o.totalQty
          : o.receivedQty === 0,
      },
      {
        // Change 25 Part L: the flag comes from the shared orderFlag(), the same rule the
        // dashboard's delayed-orders widget reads — that count and this list cannot disagree.
        key: "delay",
        label: "delays",
        options: [
          { value: "DELAYED", label: "Delayed only" },
          { value: "NO_ETA", label: "No ETA" },
        ],
        match: (o, v) => orderFlag(o).flag === v,
      },
    ],
    [supplierNames]
  );
  const csv: CsvExport<Order> = {
    filename: "trim-orders",
    columns: [
      { header: "trim", value: (o) => o.trim },
      {
        header: "split",
        value: (o) =>
          o.lines.length === 0
            ? "flat"
            : o.lines.map((l) => `${[l.colour, l.size].filter(Boolean).join(" ") || "—"} ${l.qty}`).join("; "),
      },
      { header: "total_qty", value: (o) => o.totalQty },
      { header: "unit", value: (o) => o.unit },
      // the received-vs-ordered sub-line under Total
      { header: "received_qty", value: (o) => o.receivedQty },
      { header: "due_qty", value: (o) => Math.round((o.totalQty - o.receivedQty) * 100) / 100 },
      { header: "supplier", value: (o) => o.supplier },
      { header: "po_no", value: (o) => o.poNumber ?? o.poStage },
      { header: "received_on", value: (o) => o.challans.map((c) => c.challanNo ?? `Draft #${c.id}`).join("; ") },
      { header: "status", value: (o) => o.status.replace("_", " ") },
      // the delay badge in the Status column
      { header: "days_late", value: (o) => orderFlag(o).daysLate },
      { header: "delivery_flag", value: (o) => orderFlag(o).flag },
    ],
  };
  const view = useTableView<Order>({
    id: "to",
    rows: orders,
    filters,
    search: (o) => [o.trim, o.supplier, o.poNumber, o.remarks],
    date: (o) => o.expectedDate ?? o.receivedDate,
    sorts: {
      trim: (o) => o.trim,
      qty: (o) => o.totalQty,
      supplier: (o) => o.supplier ?? "",
      status: (o) => o.status,
      daysLate: (o) => orderFlag(o).daysLate,
    },
    sum: (o) => o.totalQty,
  });

  return (
    <>
      <div ref={formRef} className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* entry */}
        <Card className="min-w-0 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="t-xs font-bold uppercase tracking-wide text-muted">
              {editingId ? "Edit trim order" : "New trim order"}
            </h3>
            {editingId && (
              <button onClick={resetForm} className="t-xs font-semibold text-t2 hover:text-danger">Cancel</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Labelled label="Trim">
              {addTrim ? (
                <div className="flex gap-1.5">
                  <input autoFocus value={trimDraft} onChange={(e) => setTrimDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmTrim()} placeholder="New trim name" className={inp} />
                  <button onClick={confirmTrim} disabled={busy} className="rounded-md border border-border px-2 text-primary-ink hover:bg-surface-2 disabled:opacity-40"><Check size={14} /></button>
                  <button onClick={() => { setAddTrim(false); setTrimDraft(""); }} className="rounded-md border border-border px-2 text-faint hover:bg-surface-2"><X size={14} /></button>
                </div>
              ) : (
                /* frozen while editing — updateTrimOrder takes no trimItemId */
                <select value={trimId} disabled={!!editingId} onChange={(e) => (e.target.value === ADD ? setAddTrim(true) : pickTrim(e.target.value))} className={`${inp} disabled:bg-surface-2 disabled:text-t2`}>
                  <option value="">— pick trim —</option>
                  {trimList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {/* Change 38 Part G */}
                  {!editingId && <option value={ADD}>Add new trim…</option>}
                </select>
              )}
            </Labelled>
            <Labelled label="Supplier">
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
                <option value="">— pick supplier —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Labelled>
            <Labelled label="Quantity">
              <input type="number" value={splitOpen && filledSplit.length > 0 ? splitTotal : qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={splitOpen && filledSplit.length > 0}
                placeholder="0" className={`${inp} text-right tnum disabled:bg-surface-2`} />
            </Labelled>
            <Labelled label="Unit">
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}>
                <option value="">—</option>
                {[...new Set([...(trim?.unit ? [trim.unit] : []), ...units])].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Labelled>
            <Labelled label="Rate (₹/unit, optional)">
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className={`${inp} text-right tnum`} />
            </Labelled>
            <Labelled label="Expected date">
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inp} />
            </Labelled>
            <div className="col-span-2">
              <Labelled label="Remarks">
                <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional" className={inp} />
              </Labelled>
            </div>
          </div>

          {/* optional colour/size split */}
          <div className="mt-3 border-t border-hairline pt-3">
            <button onClick={() => setSplitOpen((v) => !v)} className="t-xs font-semibold text-primary-ink hover:underline">
              {splitOpen ? "− Hide split" : "+ Split by colour / size"}
            </button>
            {splitOpen && (
              <div className="mt-2 space-y-1.5">
                {split.map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input list="trim-order-colours" value={l.colour} onChange={(e) => setSplitRow(i, { colour: e.target.value })} placeholder="colour" className={`${inp} w-32`} />
                    <input value={l.size} onChange={(e) => setSplitRow(i, { size: e.target.value })} placeholder="size" className={`${inp} w-24`} />
                    <input type="number" value={l.qty || ""} onChange={(e) => setSplitRow(i, { qty: +e.target.value })} placeholder="qty" className={`${inp} w-24 text-right tnum`} />
                    <button onClick={() => removeSplitRow(i)} className="text-faint hover:text-danger"><X size={13} /></button>
                  </div>
                ))}
                <datalist id="trim-order-colours">{colours.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            )}
          </div>
        </Card>

        {/* live summary */}
        <Card className="panel-invert flex flex-col justify-between p-5">
          <div>
            <div className="t-xs font-semibold uppercase tracking-wide text-t3">Order summary</div>
            <div className="mt-2 t-head font-bold">{trim?.name ?? "— pick a trim —"}</div>
            {trim && <div className="mt-0.5 t-xs text-t3">in stock: {num(trim.stock)} {trim.unit ?? ""}</div>}
            {splitOpen && filledSplit.length > 0 && (
              <div className="mt-3 space-y-1">
                {filledSplit.map((l, i) => (
                  <div key={i} className="flex justify-between t-sm text-t2">
                    <span>{[l.colour, l.size].filter(Boolean).join(" · ") || "—"}</span>
                    <span className="tnum">{num(l.qty)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 border-t border-hairline pt-3 t-body">
              <div className="flex justify-between"><span className="text-t2">Total</span><b className="tnum">{num(effectiveQty)} {unit.toLowerCase()}</b></div>
              {totalValue != null && <div className="mt-1 flex justify-between"><span className="text-t2">Value</span><b className="tnum">≈ {inr(totalValue)}</b></div>}
            </div>
          </div>
          <button onClick={editingId ? save : create} disabled={busy || !trimId || effectiveQty <= 0}
            className="mt-4 w-full rounded-lg bg-t1 px-3 py-2.5 t-body font-bold text-surface transition hover:opacity-90 disabled:opacity-40">
            {busy ? "Saving…" : editingId ? "Save changes" : "Create order"}
          </button>

          {/* Change 38 Part H — sample photos on the order itself. */}
          {attachId != null && (
            <div className="mt-4 border-t border-hairline pt-3">
              <ImageUploader
                entity="trimOrder"
                entityId={attachId}
                kind="trim"
                multiple
                label="Sample photos"
                images={orders.find((o) => o.id === attachId)?.images ?? []}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Change 23 Part C: search, status/stage/supplier + received-vs-pending filters,
          date range and click-to-sort — the trim mirror of the fabric order list. */}
      <Card className="mt-4 p-5">
        <TableToolbar view={view} filters={filters} searchPlaceholder="Search trim, supplier, PO…" dateLabel="Order date" unit="ordered" csv={csv} />

        {/* Change 40 — phones: a card per trim order, fed the same view.rows the table maps. */}
        <MobileCardList
          className="mt-2 md:hidden"
          rows={view.rows}
          keyOf={(o) => o.id}
          empty={<p className="px-2 py-10 text-center t-sm text-muted">{orders.length === 0 ? "No trim orders" : "No orders match these filters"}</p>}
          renderCard={(o) => (
            <div className={`rounded-card bg-surface p-4 elev ${editingId === o.id ? "ring-2 ring-accent/40" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-body font-bold text-primary-ink">{o.trim}</span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  <Badge tone={STATUS_TONE[o.status] ?? "default"}>{o.status.replace("_", " ")}</Badge>
                  <DelayBadge order={o} />
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 t-sm">
                <span className="tnum">
                  <b>{num(o.totalQty)}</b> {(o.unit ?? "").toLowerCase()}
                </span>
                {o.receivedQty > 0 && (
                  <span className={`tnum ${o.receivedQty < o.totalQty ? "text-warn" : "text-ok"}`}>{num(o.receivedQty)} received</span>
                )}
                {o.supplier && <span className="text-t3">{o.supplier}</span>}
                {o.lines.length > 0 && <span className="text-t3">{o.lines.length} lines</span>}
                {o.poNumber ? (
                  <Link href={`/pot/${o.id}`} className="tnum font-semibold text-primary-ink">{o.poNumber}</Link>
                ) : (
                  <span className="text-t3">{o.poStage}</span>
                )}
              </div>
            </div>
          )}
        />

        <div className="hidden overflow-x-auto md:block">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="trim">Trim</SortHeader></th>
              <th className="px-4 py-2.5 font-semibold">Split</th>
              <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="qty" align="right">Total</SortHeader></th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="supplier">Supplier</SortHeader></th>
              <th className="px-4 py-2.5 font-semibold">PO</th>
              <th className="px-4 py-2.5 font-semibold">Received on</th>
              {/* Change 25 Part L: the delay badge rides in the Status cell, so the
                  column carries a second sort for how late the order is. */}
              <th className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <SortHeader view={view} sortKey="status">Status</SortHeader>
                  <SortHeader view={view} sortKey="daysLate">Late</SortHeader>
                </span>
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((o) => (
              <tr key={o.id} className={`border-b border-hairline last:border-0 align-top ${editingId === o.id ? "bg-primary-soft/50" : ""}`}>
                <td className="px-4 py-2.5 font-semibold">
                  {o.trim}
                  {/* Change 25 Part J */}
                  {o.remarks && <div className="t-xs font-normal text-t3">{o.remarks}</div>}
                </td>
                <td className="px-4 py-2.5 text-t2">
                  {o.lines.length === 0 ? <span className="text-faint">flat</span> : (
                    <div className="flex flex-wrap gap-1">
                      {o.lines.map((l, i) => (
                        <span key={i} className="rounded bg-surface-2 px-1.5 py-0.5 t-xs">
                          {[l.colour, l.size].filter(Boolean).join(" ") || "—"} {num(l.qty)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tnum font-semibold">
                  {num(o.totalQty)} {(o.unit ?? "").toLowerCase()}
                  {/* Change 22 Part A: received-so-far vs ordered. */}
                  {o.receivedQty > 0 && (
                    <div className={`t-xs font-medium ${o.receivedQty < o.totalQty ? "text-warn" : "text-ok"}`}>
                      {num(o.receivedQty)} received
                      {o.receivedQty < o.totalQty && ` \u00b7 ${num(Math.round((o.totalQty - o.receivedQty) * 100) / 100)} due`}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-t2">{o.supplier ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge tone={STAGE_TONE[o.poStage] ?? "default"}>{o.poNumber ?? o.poStage}</Badge></td>
                <td className="px-4 py-2.5">
                  {o.challans.length === 0 ? <span className="text-faint">—</span> : (
                    <div className="flex flex-col gap-1">
                      {o.challans.map((c) => (
                        <span key={c.id} className="flex items-center gap-1">
                          <Link href={`/challan-doc/${c.id}`} className="rounded bg-surface-2 px-1.5 py-0.5 t-xs font-semibold text-primary-ink hover:underline tnum">
                            {c.challanNo ?? `Draft #${c.id}`}
                          </Link>
                          {/* Change 22 Part A: edit the log by editing the challan; reverse it to take the stock back out. */}
                          {c.status === "LOCKED" && (
                            <>
                              <Link href={`/challan-doc/${c.id}`} title="Edit this challan" className="text-t3 hover:text-primary-ink"><Pencil size={12} /></Link>
                              <button onClick={() => reverseReceipt(c)} disabled={busy} title="Reverse this receipt" className="text-t3 hover:text-danger disabled:opacity-40"><Undo2 size={12} /></button>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={STATUS_TONE[o.status] ?? "default"}>{o.status.replace("_", " ")}</Badge>
                    <DelayBadge order={o} />
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {/* Change 25 — see the fabric manager: one dialog for firm, GST and signatory. */}
                    {!o.poNumber && (
                      <GeneratePoButton
                        orderId={o.id}
                        kind="TRIM"
                        buyers={buyers}
                        disabled={busy}
                      />
                    )}
                    {o.poNumber && <Link href={`/pot/${o.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-primary-ink hover:bg-surface-2"><FileText size={12} /> Open PO</Link>}
                    {/* Change 22 Part A: RECEIVED rows stop offering "Log Inward" as the primary
                        action — edit / reverse live in the CHALLAN column; a split delivery is a
                        demoted secondary link. */}
                    {o.status !== "DISCARDED" && o.status !== "RECEIVED" && (
                      <button onClick={() => logInward(o)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-ok hover:bg-ok-soft"><Truck size={12} /> Log Inward Challan</button>
                    )}
                    {o.status === "RECEIVED" && (
                      <button onClick={() => logInward(o)} disabled={busy} className="t-xs font-medium text-t3 underline-offset-2 hover:text-primary-ink hover:underline disabled:opacity-40">log another delivery</button>
                    )}
                    {canEdit(o) && <button onClick={() => startEdit(o)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-t1 hover:bg-surface-2"><Pencil size={12} /> Edit</button>}
                    {canDelete(o) && <button onClick={() => remove(o)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-danger hover:bg-danger-soft"><Trash2 size={12} /> Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
            {view.rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">
                {orders.length === 0 ? "No trim orders" : "No orders match these filters"}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}

const inp = inputClass("md", "w-full");
/** A stored date rendered for an <input type="date">. */
const dateInput = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** Change 25 Part L: the row's read of the shared delay rule. Nothing for a closed order. */
function DelayBadge({ order }: { order: Order }) {
  const { flag, daysLate } = orderFlag(order);
  if (flag === "DELAYED") return <Badge tone="danger">{daysLate}d late</Badge>;
  if (flag === "NO_ETA") return <Badge tone="warn">No ETA</Badge>;
  return null;
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block t-micro font-semibold uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}
