"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFabricOrder, updateFabricOrder, deleteFabricOrder, draftChallanFromFabricOrder, generatePO, createColour, createFabricQuick } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { num, inr, fmtDate } from "@/lib/format";
import { Plus, Check, X, FileText, Truck, Pencil, Trash2 } from "lucide-react";

type Line = { colour: string; qty: number };
type ChallanLink = { id: number; challanNo: string | null; status: string };
type Order = {
  id: number; fabric: string; fabricId: number; supplier: string | null; supplierId: number | null;
  gsm: number | null; lines: Line[]; totalQty: number;
  colourCount: number; unit: string; rate: number | null; status: string; expectedDate: Date | string | null;
  receivedDate: Date | string | null; poNumber: string | null; poStage: string;
  // Change 18 Part C: the inward challans this order was received on.
  challans: ChallanLink[];
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
  orders, fabrics, suppliers, colours,
}: {
  orders: Order[]; fabrics: FabricPick[]; suppliers: Pick[]; colours: ColourOpt[];
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
    try {
      const c = await createColour({ name: colourDraft });
      setColourList((p) => (p.some((x) => x.name === c.name) ? p : [...p, { id: c.id, name: c.name, hex: null }].sort((a, b) => a.name.localeCompare(b.name))));
      setLine(i, { colour: c.name });
    } finally { setAddColourRow(null); setColourDraft(""); setBusy(false); }
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
    } finally { setAddFabric(false); setFabricDraft(""); setBusy(false); }
  }

  function resetForm() {
    setEditingId(null);
    setFabricId(""); setSupplierId(""); setExpected(""); setRate(""); setGsm(""); setUnit("MTR");
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
   */
  async function logInward(o: Order) {
    if (o.status === "RECEIVED" && !confirm("This PO is already received. Log another delivery challan against it?")) return;
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
   * Order lines store the canonical colorKey() value, which is not guaranteed to exist in
   * the Colour master. Without merging those back in, editing an order would render a blank
   * <select> for the unmatched colour and silently drop that line on save.
   */
  const colourOptions = useMemo(() => {
    const extra = [...new Set(lines.map((l) => l.colour).filter((c) => c && !colourList.some((x) => x.name === c)))];
    return [...colourList, ...extra.map((name, i) => ({ id: -1 - i, name, hex: null }))];
  }, [colourList, lines]);

  return (
    <>
      <div ref={formRef} className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* entry */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">
              {editingId ? "Edit fabric order" : "New fabric order"}
            </h3>
            {editingId && (
              <button onClick={resetForm} className="text-[11px] font-semibold text-slate-500 hover:text-danger">Cancel</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Fabric</label>
              {addFabric ? (
                <div className="flex gap-1.5">
                  <input autoFocus value={fabricDraft} onChange={(e) => setFabricDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmFabric()} placeholder="New fabric name" className={inp} />
                  <button onClick={confirmFabric} disabled={busy} className="rounded-lg bg-primary px-3 text-[12px] font-semibold text-white"><Check size={14} /></button>
                  <button onClick={() => setAddFabric(false)} className="rounded-lg border border-border px-3 text-slate-500"><X size={14} /></button>
                </div>
              ) : (
                // The material is frozen while editing — updateFabricOrder takes no fabricId,
                // and swapping it would need the sourcing-rate bookkeeping redone.
                <select value={fabricId} disabled={!!editingId} onChange={(e) => (e.target.value === ADD ? setAddFabric(true) : pickFabric(e.target.value))} className={`${inp} disabled:bg-slate-50 disabled:text-slate-500`}>
                  <option value="">Fabric…</option>
                  {fabricList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  {!editingId && <option value={ADD}>➕ Add new fabric…</option>}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inp}>
                <option value="">Supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Expected date</label>
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Rate (₹/unit, optional)</label>
              <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">GSM (optional)</label>
              <input type="number" value={gsm} onChange={(e) => setGsm(e.target.value)} placeholder="—" className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Unit</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inp}>
                <option value="MTR">MTR</option>
                <option value="KG">KG</option>
              </select>
            </div>
          </div>

          {/* colour × qty */}
          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Colours &amp; quantities</label>
            <div className="space-y-1.5">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {addColourRow === i ? (
                    <>
                      <input autoFocus value={colourDraft} onChange={(e) => setColourDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmColour(i)} placeholder="New colour" className={`${inp} flex-1`} />
                      <button onClick={() => confirmColour(i)} disabled={busy} className="rounded-lg bg-primary px-2.5 py-2 text-white"><Check size={14} /></button>
                      <button onClick={() => setAddColourRow(null)} className="rounded-lg border border-border px-2.5 py-2 text-slate-500"><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <select value={l.colour} onChange={(e) => onColour(i, e.target.value)} className={`${inp} flex-1`}>
                        <option value="">Colour…</option>
                        {colourOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        <option value={ADD}>➕ Add new colour…</option>
                      </select>
                      <input type="number" value={l.qty || ""} placeholder="0" onChange={(e) => setLine(i, { qty: Math.max(0, +e.target.value) })} className="w-24 rounded-lg border border-border px-2.5 py-2 text-right text-[13px] tnum outline-none focus:border-primary" />
                      <button onClick={() => removeLine(i)} className="text-faint hover:text-danger"><X size={14} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* live summary */}
        <Card className="border-slate-800 bg-gradient-to-b from-[#0f1226] to-[#1b1f3b] p-5 text-indigo-50">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-indigo-300">Order summary</h3>
          {!fabricId ? (
            <div className="flex h-40 items-center justify-center text-center text-[12px] text-indigo-300/70">Pick a fabric and add colours.</div>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-white">{fabricList.find((f) => String(f.id) === fabricId)?.name}</div>
              <div className="mt-3 space-y-1.5">
                {filled.map((l, i) => (
                  <div key={i} className="flex justify-between border-b border-white/10 pb-1 text-[12px]">
                    <span className="text-indigo-200">{l.colour}</span>
                    <span className="font-bold tnum">{num(l.qty)}</span>
                  </div>
                ))}
                {filled.length === 0 && <div className="text-[12px] text-indigo-300/60">No colours yet.</div>}
              </div>
              <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-3">
                <span className="text-[12px] text-indigo-200">{filled.length} colour{filled.length === 1 ? "" : "s"} · total</span>
                <span className="text-[24px] font-extrabold text-white tnum">{num(totalQty)}</span>
              </div>
              {totalValue != null && <div className="mt-1 text-right text-[12px] text-indigo-200">≈ {inr(totalValue)}</div>}
              <button onClick={editingId ? save : create} disabled={busy || !fabricId || filled.length === 0} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40">
                {busy ? "Saving…" : editingId ? "Save changes" : "Create order"}
              </button>
            </>
          )}
        </Card>
      </div>

      {/* order list */}
      <Card className="mt-4 overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-semibold">Fabric</th>
              <th className="px-4 py-2.5 font-semibold">Colours</th>
              <th className="px-4 py-2.5 text-right font-semibold">Total</th>
              <th className="px-4 py-2.5 font-semibold">Supplier</th>
              <th className="px-4 py-2.5 font-semibold">PO</th>
              <th className="px-4 py-2.5 font-semibold">Received on</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className={`border-b border-slate-50 last:border-0 align-top ${editingId === o.id ? "bg-primary-soft/50" : ""}`}>
                <td className="px-4 py-2.5 font-semibold">{o.fabric}</td>
                <td className="px-4 py-2.5 text-slate-500">
                  <div className="flex flex-wrap gap-1">
                    {o.lines.map((l, i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{l.colour} {num(l.qty)}</span>)}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tnum font-semibold">{num(o.totalQty)} {o.unit.toLowerCase()}</td>
                <td className="px-4 py-2.5 text-slate-500">{o.supplier ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge tone={STAGE_TONE[o.poStage] ?? "default"}>{o.poNumber ?? o.poStage}</Badge></td>
                <td className="px-4 py-2.5">
                  {o.challans.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {o.challans.map((c) => (
                        <Link key={c.id} href={`/challan-doc/${c.id}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-primary-ink hover:underline tnum">
                          {c.challanNo ?? `Draft #${c.id}`}
                        </Link>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[o.status] ?? "default"}>{o.status.replace("_", " ")}</Badge></td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {!o.poNumber && <button onClick={() => act(() => generatePO({ id: o.id }))} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-primary-ink hover:bg-slate-50"><FileText size={12} /> Generate PO</button>}
                    {o.poNumber && <Link href={`/po/${o.id}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-primary-ink hover:bg-slate-50"><FileText size={12} /> Open PO</Link>}
                    {o.status !== "DISCARDED" && <button onClick={() => logInward(o)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"><Truck size={12} /> Log Inward Challan</button>}
                    {canEdit(o) && <button onClick={() => startEdit(o)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"><Pencil size={12} /> Edit</button>}
                    {canDelete(o) && <button onClick={() => remove(o)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger-soft"><Trash2 size={12} /> Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">No fabric orders yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

const inp = "w-full rounded-lg border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary";
/** A stored date rendered for an <input type="date">. */
const dateInput = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
