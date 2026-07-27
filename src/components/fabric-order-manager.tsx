"use client";

import { inputClass } from "@/components/ui";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFabricOrder, updateFabricOrder, deleteFabricOrder, draftChallanFromFabricOrder, generatePO, createColour, createFabricQuick, voidChallan } from "@/lib/actions";
import { Card, Badge, SortHeader, TableToolbar, useTableView, type CsvExport, type FilterDef } from "@/components/ui";
import { num, inr, fmtDate } from "@/lib/format";
import { orderFlag } from "@/lib/order-flags";
import { GeneratePoButton, type BuyerOption, type SignatoryOption } from "@/components/generate-po";
import { Plus, Check, X, FileText, Truck, Pencil, Trash2, Undo2, CornerUpLeft } from "lucide-react";

type Line = { colour: string; qty: number };
type ChallanLink = { id: number; challanNo: string | null; status: string };
type Order = {
  id: number; fabric: string; fabricId: number; supplier: string | null; supplierId: number | null;
  gsm: number | null; lines: Line[]; totalQty: number;
  colourCount: number; unit: string; rate: number | null; status: string; expectedDate: Date | string | null;
  remarks: string | null;
  receivedDate: Date | string | null; poNumber: string | null; poStage: string;
  // Change 18 Part C: the inward challans this order was received on.
  challans: ChallanLink[];
  // Change 22 Part A: Σ locked challan line qty — what has actually arrived.
  receivedQty: number;
};
type Pick = { id: number; name: string };
type FabricPick = { id: number; name: string; unit?: string };
type ColourOpt = { id: number; name: string; hex: string | null };

const STATUS_TONE: Record<string, "primary" | "warn" | "ok" | "default" | "danger"> = {
  PLANNING: "default", SAMPLE_PENDING: "warn", ORDER_PLACED: "primary", RECEIVED: "ok", DISCARDED: "danger",
};
const STAGE_TONE: Record<string, "default" | "primary" | "ok"> = { Draft: "default", "PO Generated": "primary", Sent: "ok" };
const ADD = "__add__";

export function FabricOrderManager({
  orders, fabrics, suppliers, colours, buyers, signatories, meId, canOverrideSignatory,
}: {
  orders: Order[]; fabrics: FabricPick[]; suppliers: Pick[]; colours: ColourOpt[];
  // Change 25 G.3 / I.2 / K.2 — issued from which firm, GST %, and who signs it.
  buyers: BuyerOption[]; signatories: SignatoryOption[]; meId: number; canOverrideSignatory: boolean;
}) {
  const router = useRouter();
  const [fabricList, setFabricList] = useState<FabricPick[]>(fabrics);
  const [colourList, setColourList] = useState(colours);
  const [fabricId, setFabricId] = useState("");
  const [addFabric, setAddFabric] = useState(false);
  const [fabricDraft, setFabricDraft] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [expected, setExpected] = useState("");
  const [rate, setRate] = useState("");
  const [gsm, setGsm] = useState("");
  // Change 25 Part J: the column and the create action always supported a remark;
  // this form simply never rendered the input, so it could not be entered.
  const [remarks, setRemarks] = useState("");
  // Change 17 Part G: unit is selectable per order, defaulting from the fabric master.
  const [unit, setUnit] = useState("MTR");

  // Default the unit from the picked fabric's master unit (override stays possible).
  function pickFabric(id: string) {
    setFabricId(id);
    const f = fabricList.find((x) => String(x.id) === id);
    if (f?.unit) setUnit(f.unit);
  }
  const [lines, setLines] = useState<Line[]>([{ colour: "", qty: 0 }]);
  const [addColourRow, setAddColourRow] = useState<number | null>(null);
  const [colourDraft, setColourDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Change 20: the same form doubles as the edit form for an unlocked order.
  const [editingId, setEditingId] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // keep a trailing empty row once the last row is filled
  function normalizeRows(rows: Line[]): Line[] {
    const last = rows[rows.length - 1];
    if (last && last.colour && last.qty > 0) return [...rows, { colour: "", qty: 0 }];
    return rows;
  }
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((rows) => normalizeRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))));
  const removeLine = (i: number) => setLines((rows) => (rows.length <= 1 ? [{ colour: "", qty: 0 }] : rows.filter((_, idx) => idx !== i)));

  const filled = useMemo(() => lines.filter((l) => l.colour && l.qty > 0), [lines]);
  const totalQty = filled.reduce((a, l) => a + l.qty, 0);
  const totalValue = rate ? totalQty * +rate : null;

  async function onColour(i: number, val: string) {
    if (val === ADD) { setAddColourRow(i); setColourDraft(""); return; }
    setLine(i, { colour: val });
  }
  async function confirmColour(i: number) {
    if (!colourDraft.trim()) { setAddColourRow(null); return; }
    setBusy(true);
    // Change 25 Part B: was try/finally with no catch — a duplicate colour name threw
    // and the row silently closed with the colour unset.
    try {
      const c = await createColour({ name: colourDraft });
      setColourList((p) => (p.some((x) => x.name === c.name) ? p : [...p, { id: c.id, name: c.name, hex: null }].sort((a, b) => a.name.localeCompare(b.name))));
      setLine(i, { colour: c.name });
    } catch (e) { alert((e as Error).message); }
    finally { setAddColourRow(null); setColourDraft(""); setBusy(false); }
  }
  async function confirmFabric() {
    if (!fabricDraft.trim()) { setAddFabric(false); return; }
    setBusy(true);
    try {
      // Change 17 Part G: a new fabric created while ordering carries supplier + unit + rate up to its master.
      const f = await createFabricQuick({
        name: fabricDraft,
        unit: unit as "KG" | "MTR",
        supplierId: supplierId ? +supplierId : null,
        rate: rate ? +rate : null,
      });
      const withUnit: FabricPick = { id: f.id, name: f.name, unit };
      setFabricList((p) => (p.some((x) => x.id === f.id) ? p : [...p, withUnit].sort((a, b) => a.name.localeCompare(b.name))));
      setFabricId(String(f.id));
    } catch (e) { alert((e as Error).message); }
    finally { setAddFabric(false); setFabricDraft(""); setBusy(false); }
  }

  function resetForm() {
    setEditingId(null);
    setFabricId(""); setSupplierId(""); setExpected(""); setRate(""); setGsm(""); setUnit("MTR"); setRemarks("");
    setLines([{ colour: "", qty: 0 }]);
    setAddColourRow(null); setColourDraft(""); setAddFabric(false); setFabricDraft("");
  }

  async function create() {
    if (!fabricId || filled.length === 0) return;
    setBusy(true);
    try {
      await createFabricOrder({
        fabricId: +fabricId, supplierId: supplierId ? +supplierId : null,
        expectedDate: expected || null, rate: rate ? +rate : null, gsm: gsm ? +gsm : null,
        unit: unit as "KG" | "MTR",
        remarks: remarks.trim() || null,
        lines: filled,
      });
      resetForm();
      router.refresh();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }

  function startEdit(o: Order) {
    setEditingId(o.id);
    setFabricId(String(o.fabricId));
    setSupplierId(o.supplierId ? String(o.supplierId) : "");
    setExpected(dateInput(o.expectedDate));
    setRate(o.rate != null ? String(o.rate) : "");
    setGsm(o.gsm != null ? String(o.gsm) : "");
    setRemarks(o.remarks ?? "");
    setUnit(o.unit);
    setLines([...o.lines.map((l) => ({ colour: l.colour, qty: l.qty })), { colour: "", qty: 0 }]);
    setAddColourRow(null); setAddFabric(false);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save() {
    if (!editingId || filled.length === 0) return;
    setBusy(true);
    try {
      await updateFabricOrder({
        id: editingId, supplierId: supplierId ? +supplierId : null,
        expectedDate: expected || null, rate: rate ? +rate : null, gsm: gsm ? +gsm : null,
        unit: unit as "KG" | "MTR",
        remarks: remarks.trim() || null,
        lines: filled,
      });
      resetForm();
      router.refresh();
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(o: Order) {
    if (!confirm(`Delete the ${o.fabric} order (${num(o.totalQty)} ${o.unit.toLowerCase()})? This cannot be undone.`)) return;
    if (editingId === o.id) resetForm();
    await act(() => deleteFabricOrder({ id: o.id }));
  }

  // Mirrors the server guards in deleteFabricOrder / updateFabricOrder.
  const canEdit = (o: Order) => !o.poNumber && !o.receivedDate;
  const canDelete = (o: Order) => canEdit(o) && o.challans.length === 0;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); router.refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  /**
   * Change 18 Part A: receiving is logging an inward challan, not a one-click "Receive".
   * The draft opens pre-filled from the PO so quantities can be corrected to the real
   * delivery; LOCKING that challan is what puts fabric into stock.
   *
   * Change 22 Part A: the "already received, log another?" confirm is gone — a RECEIVED
   * order no longer offers this as its primary action at all, so reaching it is now an
   * explicit choice ("log another delivery") rather than a mis-click.
   */
  async function logInward(o: Order) {
    setBusy(true);
    try {
      const { id } = await draftChallanFromFabricOrder({ id: o.id });
      router.push(`/challan-doc/${id}`);
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  }

  /**
   * Change 22 Part A: reverse a receipt. voidChallan already reverses every posted line and
   * drops the order back to ORDER_PLACED when no other locked challan holds it received.
   */
  async function reverseReceipt(c: ChallanLink) {
    if (!confirm(`Reverse ${c.challanNo ?? `challan #${c.id}`} and take this stock back out?`)) return;
    await act(() => voidChallan({ id: c.id }));
  }

  /**
   * Order lines store the canonical colorKey() value, which is not guaranteed to exist in
   * the Colour master. Without merging those back in, editing an order would render a blank
   * <select> for the unmatched colour and silently drop that line on save.
   */
  const colourOptions = useMemo(() => {
    const extra = [...new Set(lines.map((l) => l.colour).filter((c) => c && !colourList.some((x) => x.name === c)))];
    return [...colourList, ...extra.map((name, i) => ({ id: -1 - i, name, hex: null }))];
  }, [colourList, lines]);

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
    filename: "fabric-orders",
    columns: [
      { header: "fabric", value: (o) => o.fabric },
      { header: "colours", value: (o) => o.lines.map((l) => `${l.colour} ${l.qty}`).join("; ") },
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
    id: "fo",
    rows: orders,
    filters,
    search: (o) => [o.fabric, o.supplier, o.poNumber, ...o.lines.map((l) => l.colour)],
    date: (o) => o.expectedDate ?? o.receivedDate,
    sorts: {
      fabric: (o) => o.fabric,
      qty: (o) => o.totalQty,
      supplier: (o) => o.supplier ?? "",
      status: (o) => o.status,
      date: (o) => (o.expectedDate ? new Date(o.expectedDate) : null),
      daysLate: (o) => orderFlag(o).daysLate,
    },
    sum: (o) => o.totalQty,
  });

  return (
    <>
      <div ref={formRef} className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* entry */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="t-xs font-bold uppercase tracking-wide text-muted">
              {editingId ? "Edit fabric order" : "New fabric order"}
            </h3>
            {editingId && (
              <button onClick={resetForm} className="t-xs font-semibold text-t2 hover:text-danger">Cancel</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <label className="mb-1 block t-xs font-semibold text-t1">Fabric</label>
              {addFabric ? (
                <div className="flex gap-1.5">
                  <input autoFocus value={fabricDraft} onChange={(e) => setFabricDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmFabric()} placeholder="New fabric name" className={inp} />
                  <button onClick={confirmFabric} disabled={busy} className="rounded-lg bg-primary px-3 t-sm font-semibold text-accent-on"><Check size={14} /></button>
                  <button onClick={() => setAddFabric(false)} className="rounded-lg border border-border px-3 text-t2"><X size={14} /></button>
                </div>
              ) : (
                // The material is frozen while editing — updateFabricOrder takes no fabricId,
                // and swapping it would need the sourcing-rate bookkeeping redone.
                <select value={fabricId} disabled={!!editingId} onChange={(e) => (e.target.value === ADD ? setAddFabric(true) : pickFabric(e.target.value))} className={`${inp} disabled:bg-surface-2 disabled:text-t2`}>
                  <option value="">Fabric…</option>
                  {fabricList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  {!editingId && <option value={ADD}>➕ Add new fabric…</option>}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block t-xs font-semibold text-t1">Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
                <option value="">Supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block t-xs font-semibold text-t1">Expected date</label>
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="mb-1 block t-xs font-semibold text-t1">Rate (₹/unit, optional)</label>
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className={inp} />
            </div>
            <div>
              <label className="mb-1 block t-xs font-semibold text-t1">GSM (optional)</label>
              <input type="number" value={gsm} onChange={(e) => setGsm(e.target.value)} placeholder="—" className={inp} />
            </div>
            <div>
              <label className="mb-1 block t-xs font-semibold text-t1">Unit</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}>
                <option value="MTR">MTR</option>
                <option value="KG">KG</option>
              </select>
            </div>
            {/* Change 25 Part J */}
            <div className="col-span-2">
              <label className="mb-1 block t-xs font-semibold text-t1">Remark</label>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="—" className={inp} />
            </div>
          </div>

          {/* colour × qty */}
          <div className="mt-4">
            <label className="mb-1.5 block t-xs font-semibold text-t1">Colours &amp; quantities</label>
            <div className="space-y-1.5">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {addColourRow === i ? (
                    <>
                      <input autoFocus value={colourDraft} onChange={(e) => setColourDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmColour(i)} placeholder="New colour" className={`${inp} flex-1`} />
                      <button onClick={() => confirmColour(i)} disabled={busy} className="rounded-lg bg-primary px-2.5 py-2 text-accent-on"><Check size={14} /></button>
                      <button onClick={() => setAddColourRow(null)} className="rounded-lg border border-border px-2.5 py-2 text-t2"><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <select value={l.colour} onChange={(e) => onColour(i, e.target.value)} className={`${inp} flex-1`}>
                        <option value="">Colour…</option>
                        {colourOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        <option value={ADD}>➕ Add new colour…</option>
                      </select>
                      <input type="number" value={l.qty || ""} placeholder="0" onChange={(e) => setLine(i, { qty: Math.max(0, +e.target.value) })} className="w-24 rounded-lg border border-border px-2.5 py-2 text-right t-body tnum outline-none focus:border-primary" />
                      <button onClick={() => removeLine(i)} className="text-faint hover:text-danger"><X size={14} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* live summary */}
        <Card className="panel-invert p-5">
          <h3 className="mb-4 t-xs font-bold uppercase tracking-wide text-t3">Order summary</h3>
          {!fabricId ? (
            <div className="flex h-40 items-center justify-center text-center t-sm text-t3">Select a fabric.</div>
          ) : (
            <>
              <div className="t-body font-semibold text-t1">{fabricList.find((f) => String(f.id) === fabricId)?.name}</div>
              <div className="mt-3 space-y-1.5">
                {filled.map((l, i) => (
                  <div key={i} className="flex justify-between border-b border-hairline pb-1 t-sm">
                    <span className="text-t2">{l.colour}</span>
                    <span className="font-bold tnum">{num(l.qty)}</span>
                  </div>
                ))}
                {filled.length === 0 && <div className="t-sm text-t3">No colours yet.</div>}
              </div>
              <div className="mt-3 flex items-end justify-between border-t border-hairline pt-3">
                <span className="t-sm text-t2">{filled.length} colour{filled.length === 1 ? "" : "s"} · total</span>
                <span className="t-display font-extrabold text-t1 tnum">{num(totalQty)}</span>
              </div>
              {totalValue != null && <div className="mt-1 text-right t-sm text-t2">≈ {inr(totalValue)}</div>}
              <button onClick={editingId ? save : create} disabled={busy || !fabricId || filled.length === 0} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 t-body font-semibold text-accent-on shadow-sm transition hover:opacity-90 disabled:opacity-40">
                {busy ? "Saving…" : editingId ? "Save changes" : "Create order"}
              </button>
            </>
          )}
        </Card>
      </div>

      {/* Change 23 Part C: a long order history is only usable once you can slice it —
          search, status/stage/supplier filters, received-vs-pending, date range, sort. */}
      <Card className="mt-4 p-5">
        <TableToolbar view={view} filters={filters} searchPlaceholder="Search fabric, supplier, PO…" dateLabel="Order date" unit="ordered" csv={csv} />
        <div className="overflow-x-auto">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="fabric">Fabric</SortHeader></th>
              <th className="px-4 py-2.5 font-semibold">Colours</th>
              <th className="px-4 py-2.5 text-right"><SortHeader view={view} sortKey="qty" align="right">Total</SortHeader></th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="supplier">Supplier</SortHeader></th>
              <th className="px-4 py-2.5"><SortHeader view={view} sortKey="date">PO</SortHeader></th>
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
                  {o.fabric}
                  {/* Change 25 Part J */}
                  {o.remarks && <div className="t-xs font-normal text-t3">{o.remarks}</div>}
                </td>
                <td className="px-4 py-2.5 text-t2">
                  <div className="flex flex-wrap gap-1">
                    {o.lines.map((l, i) => <span key={i} className="rounded bg-surface-2 px-1.5 py-0.5 t-xs">{l.colour} {num(l.qty)}</span>)}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tnum font-semibold">
                  {num(o.totalQty)} {o.unit.toLowerCase()}
                  {/* Change 22 Part A: received-so-far vs ordered, so a short delivery is
                      obvious and the owner knows more is still due. */}
                  {o.receivedQty > 0 && (
                    <div className={`t-xs font-medium ${o.receivedQty < o.totalQty ? "text-warn" : "text-ok"}`}>
                      {num(o.receivedQty)} received
                      {o.receivedQty < o.totalQty && ` · ${num(Math.round((o.totalQty - o.receivedQty) * 100) / 100)} due`}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-t2">{o.supplier ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge tone={STAGE_TONE[o.poStage] ?? "default"}>{o.poNumber ?? o.poStage}</Badge></td>
                <td className="px-4 py-2.5">
                  {o.challans.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {o.challans.map((c) => (
                        <span key={c.id} className="flex items-center gap-1">
                          <Link href={`/challan-doc/${c.id}`} className="rounded bg-surface-2 px-1.5 py-0.5 t-xs font-semibold text-primary-ink hover:underline tnum">
                            {c.challanNo ?? `Draft #${c.id}`}
                          </Link>
                          {/* Change 22 Part A: if we have to edit the log, edit the challan.
                              /challan-doc already edits a LOCKED challan via editLockedChallan
                              (void + reissue, same number, PO stays RECEIVED). */}
                          {c.status === "LOCKED" && (
                            <>
                              <Link href={`/challan-doc/${c.id}`} title="Edit this challan" className="text-t3 hover:text-primary-ink"><Pencil size={12} /></Link>
                              <button onClick={() => reverseReceipt(c)} disabled={busy} title="Reverse this receipt" className="text-t3 hover:text-danger disabled:opacity-40"><Undo2 size={12} /></button>
                              {/* Change 25 Part D. Distinct from Reverse: that says the receipt
                                  never happened; this sends accepted goods back and leaves the PO
                                  received. The quantities live on the document, so it links there. */}
                              <Link href={`/challan-doc/${c.id}`} title="Return to supplier" className="text-t3 hover:text-warn"><CornerUpLeft size={12} /></Link>
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
                    {/* Change 25: generating a PO now also chooses the issuing firm, the delivery
                        address, the GST % and the signatory — one dialog, since all three
                        parts attach at exactly this moment. */}
                    {!o.poNumber && (
                      <GeneratePoButton
                        orderId={o.id}
                        kind="FABRIC"
                        buyers={buyers}
                        signatories={signatories}
                        meId={meId}
                        canOverrideSignatory={canOverrideSignatory}
                        disabled={busy}
                      />
                    )}
                    {o.poNumber && <Link href={`/po/${o.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 t-xs font-semibold text-primary-ink hover:bg-surface-2"><FileText size={12} /> Open PO</Link>}
                    {/* Change 22 Part A: once RECEIVED, logging another inward is no longer
                        the primary action — the row's job is now edit / reverse (in the
                        CHALLAN column). A genuine split delivery is still one click away,
                        just demoted to a quiet secondary link. */}
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
                {orders.length === 0 ? "No fabric orders yet." : "No orders match these filters."}
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
