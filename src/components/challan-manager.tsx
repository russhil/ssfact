"use client";

import { inputClass } from "@/components/ui";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createChallan, addChallanLine, lockChallan, voidChallan, openOrdersForSupplier, orderLinesForFill } from "@/lib/actions";
import { Card, Badge, MobileCardList, SortHeader, TableToolbar, useTableView, useConfirm, type CsvExport, type FilterDef } from "@/components/ui";
import { num, inr, fmtDate } from "@/lib/format";
import { X, Printer } from "lucide-react";

type Opt = { id: number; name: string };
type JobOpt = { id: number; label: string };
type ChallanRow = {
  id: number; direction: string; status: string; kind: string | null; challanNo: string | null; date: Date;
  counterparty: string; jobCardId: number | null; jobCardSiNo: string | null;
  note: string | null; lineCount: number; totalQty: number; totalValue: number | null;
};
// Change 40 H2 — rolls + widthInch are two independent physical counts on FABRIC lines, both
// starting BLANK; `ordered` is the PO target shown beside the (blank) qty after "Fill from PO".
type Line = { kind: "fabric" | "trim"; refId: number | 0; colour: string; qty: string; unit: string; rate: string; note: string; rolls: string; widthInch: string; ordered: string };
type OpenOrder = { id: number; kind: "fabric" | "trim"; poNumber: string | null; itemName: string; qty: number; unit: string; expectedDate: Date | null; isDraft: boolean; partlyReceived: boolean; label: string };

const emptyLine = (): Line => ({ kind: "fabric", refId: 0, colour: "", qty: "", unit: "", rate: "", note: "", rolls: "", widthInch: "", ordered: "" });
const inp = inputClass("sm");

// Derive a challan's kind from the lines it holds (mirrors the server helper).
function kindOf(hasFabric: boolean, hasTrim: boolean): "FABRIC" | "TRIM" | "COMBINED" | null {
  if (hasFabric && hasTrim) return "COMBINED";
  if (hasFabric) return "FABRIC";
  if (hasTrim) return "TRIM";
  return null;
}
const KIND_TONE: Record<string, "ok" | "warn" | "default"> = { FABRIC: "ok", TRIM: "warn", COMBINED: "default" };

export function ChallanManager({
  fabrics, trims, suppliers, vendors, colours, challans, jobCards = [], initialJobCardId = null, initialDirection = "OUTWARD",
}: {
  fabrics: Opt[]; trims: Opt[]; suppliers: Opt[]; vendors: Opt[]; colours: { name: string }[]; challans: ChallanRow[];
  jobCards?: JobOpt[]; initialJobCardId?: number | null; initialDirection?: "INWARD" | "OUTWARD";
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"INWARD" | "OUTWARD">(initialDirection);
  const [counterparty, setCounterparty] = useState<number | 0>(0);
  const [jobCardId, setJobCardId] = useState<number | 0>(initialJobCardId ?? 0);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  // Change 40 I6 — explicit job-work type for the number code on an outward job-work challan
  // (sublimation/printing/embroidery/laser); "" = a plain material challan (code from kind).
  const [workType, setWorkType] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);

  // Change 40 Part H — the one inward control: Against PO ▾ / No PO yet. Empty + disabled until
  // a supplier is chosen; picking one loads that supplier's open POs (that filter is what keeps
  // the list to a handful). "No PO yet" (path C) marks the challan P.O.-pending to link later.
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [poChoice, setPoChoice] = useState<string>(""); // "" = none picked, "PENDING", or `${kind}:${id}`
  const [loadingPos, setLoadingPos] = useState(false);

  const partyOptions = tab === "INWARD" ? suppliers : vendors;
  const jobLabel = (id: number) => jobCards.find((j) => j.id === id)?.label ?? "";

  // Load the supplier's open orders whenever the inward supplier changes.
  useEffect(() => {
    if (tab !== "INWARD" || !counterparty) { setOpenOrders([]); setPoChoice(""); return; }
    let live = true;
    setLoadingPos(true);
    openOrdersForSupplier(counterparty, "both")
      .then((rows) => { if (live) setOpenOrders(rows as OpenOrder[]); })
      .catch(() => { if (live) setOpenOrders([]); })
      .finally(() => { if (live) setLoadingPos(false); });
    return () => { live = false; };
  }, [tab, counterparty]);

  const pickedOrder = useMemo(() => {
    if (!poChoice || poChoice === "PENDING") return null;
    const [, idStr] = poChoice.split(":");
    return openOrders.find((o) => String(o.id) === idStr && `${o.kind}:${o.id}` === poChoice) ?? null;
  }, [poChoice, openOrders]);

  async function fillFromPO() {
    if (!pickedOrder) return;
    setBusy(true);
    try {
      const rows = await orderLinesForFill(pickedOrder.kind, pickedOrder.id);
      // Append the PO structure to any already-typed lines (never overwrite). Qty/rolls/width
      // stay blank; the ordered figure rides along as a target.
      const filled = lines.filter((l) => l.refId && +l.qty > 0);
      const poLines: Line[] = rows.map((r) => ({
        kind: r.kind, refId: r.refId, colour: r.colour, qty: "", unit: r.unit ?? "",
        rate: r.rate != null ? String(r.rate) : "", note: "", rolls: "", widthInch: "",
        ordered: `${num(r.orderedQty)}${r.unit ? ` ${r.unit}` : ""}`,
      }));
      setLines([...filled, ...poLines, emptyLine()]);
    } catch (e) {
      alert("Could not fill from PO: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  function normalize(rows: Line[]): Line[] {
    const last = rows[rows.length - 1];
    if (last && last.refId && +last.qty > 0) return [...rows, emptyLine()];
    return rows;
  }
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((rows) => normalize(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))));
  const removeLine = (i: number) => setLines((rows) => (rows.length <= 1 ? [emptyLine()] : rows.filter((_, idx) => idx !== i)));

  const filled = useMemo(() => lines.filter((l) => l.refId && +l.qty > 0), [lines]);
  const totalQty = filled.reduce((a, l) => a + +l.qty, 0);
  const anyRate = filled.some((l) => l.rate && +l.rate > 0);
  const totalValue = anyRate ? filled.reduce((a, l) => a + +l.qty * (+l.rate || 0), 0) : null;
  // Change 40 H2.2 — display-only sanity check: metres ÷ rolls. Never stored, never fills qty.
  const totalRolls = filled.reduce((a, l) => a + (l.kind === "fabric" ? +l.rolls || 0 : 0), 0);
  const fabricQtyWithRolls = filled.reduce((a, l) => a + (l.kind === "fabric" && +l.rolls > 0 ? +l.qty : 0), 0);
  const avgPerRoll = totalRolls > 0 ? fabricQtyWithRolls / totalRolls : null;

  // Live derived kind + the "attach a job card" warning (Change 17 Part C).
  const draftKind = kindOf(filled.some((l) => l.kind === "fabric"), filled.some((l) => l.kind === "trim"));
  const needsJobCard = (draftKind === "TRIM" || draftKind === "COMBINED") && !jobCardId;

  async function save(lockAfter: boolean) {
    if (!counterparty || filled.length === 0) return;
    setBusy(true);
    try {
      const isInward = tab === "INWARD";
      const fabricOrderId = isInward && pickedOrder?.kind === "fabric" ? pickedOrder.id : null;
      const trimOrderId = isInward && pickedOrder?.kind === "trim" ? pickedOrder.id : null;
      const { id } = await createChallan({
        direction: tab,
        supplierId: isInward ? counterparty : null,
        vendorId: tab === "OUTWARD" ? counterparty : null,
        jobCardId: jobCardId || null,
        date: date || undefined,
        note: note.trim() || null,
        fabricOrderId,
        trimOrderId,
        poPending: isInward && poChoice === "PENDING",
        workType: tab === "OUTWARD" && workType ? workType : null,
      });
      for (const l of filled) {
        await addChallanLine(id, {
          fabricId: l.kind === "fabric" ? l.refId : null,
          colour: l.kind === "fabric" ? l.colour || null : null,
          trimItemId: l.kind === "trim" ? l.refId : null,
          qty: +l.qty,
          unit: l.unit || null,
          rate: l.rate ? +l.rate : null,
          note: l.note || null,
          rolls: l.kind === "fabric" && l.rolls ? +l.rolls : null,
          widthInch: l.kind === "fabric" && l.widthInch ? +l.widthInch : null,
        });
      }
      if (lockAfter) await lockChallan({ id });
      router.push(`/challan-doc/${id}`);
    } catch (e) {
      setBusy(false);
      alert("Could not save: " + (e as Error).message);
    }
  }

  return (
    <div>
      {/* tabs */}
      <div className="mb-3.5 flex gap-1.5">
        {(["OUTWARD", "INWARD"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setCounterparty(0); }}
            className={`rounded-lg px-3.5 py-1.5 t-sm font-semibold transition ${tab === t ? "bg-primary text-accent-on" : "border border-border bg-surface text-t2 hover:bg-surface-2"}`}
          >
            {t === "OUTWARD" ? "Outward → Vendor" : "Inward ← Supplier"}
          </button>
        ))}
      </div>

      {/* min-w-0 on both children: grid items default to min-width:auto, so the wide line
          table below would otherwise force this track past its share — pushing the summary
          column off-screen and stopping its own overflow-x-auto from ever engaging. */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* entry */}
        <Card className="min-w-0 p-5">
          <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">
            New {tab === "OUTWARD" ? "delivery" : "inward"} challan
          </h3>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">{tab === "INWARD" ? "Supplier" : "Vendor"}</label>
              <select value={counterparty} onChange={(e) => setCounterparty(+e.target.value)} className={`${inp} w-full`}>
                <option value={0}>— pick {tab === "INWARD" ? "supplier" : "vendor"} —</option>
                {partyOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inp} w-full`} />
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">
                Job card <span className="font-normal text-faint">(optional for fabric)</span>
              </label>
              <input
                list="challan-jobcards"
                defaultValue={jobCardId ? jobLabel(jobCardId) : ""}
                onChange={(e) => {
                  const hit = jobCards.find((j) => j.label === e.target.value);
                  setJobCardId(hit ? hit.id : 0);
                }}
                placeholder="search SI / item…"
                className={`${inp} w-full`}
              />
              <datalist id="challan-jobcards">{jobCards.map((j) => <option key={j.id} value={j.label} />)}</datalist>
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Note <span className="font-normal text-faint">(optional)</span></label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="remarks…" className={`${inp} w-full`} />
            </div>
          </div>

          {needsJobCard && (
            <div className="mt-2.5 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 t-xs font-medium text-warn">
              No job card attached to this challan.
            </div>
          )}

          {/* Change 40 I6 — job-work type on an outward challan, for the 3-letter number code. */}
          {tab === "OUTWARD" && (
            <div className="mt-2.5">
              <label className="mb-1.5 block t-xs font-semibold text-t1">Job-work type <span className="font-normal text-faint">(optional)</span></label>
              <select value={workType} onChange={(e) => setWorkType(e.target.value)} className={`${inp} w-full`}>
                <option value="">Plain material (code from lines)</option>
                <option value="SUBLIMATION">Sublimation (SUB)</option>
                <option value="PRINT">Printing (PRI)</option>
                <option value="EMBROIDERY">Embroidery (EMB)</option>
                <option value="LASER">Laser (LAS)</option>
              </select>
            </div>
          )}

          {/* Change 40 Part H — the single inward control. This is the ONLY place received qty is
              ever typed; the PO screen's "Log inward" now redirects here. */}
          {tab === "INWARD" && (
            <div className="mt-2.5">
              <label className="mb-1.5 block t-xs font-semibold text-t1">Against PO</label>
              <select
                value={poChoice}
                disabled={!counterparty || loadingPos}
                onChange={(e) => setPoChoice(e.target.value)}
                className={`${inp} w-full`}
              >
                <option value="">{!counterparty ? "— pick a supplier first —" : loadingPos ? "loading POs…" : "— pick a PO —"}</option>
                {counterparty > 0 && <option value="PENDING">No PO yet — mark P.O. pending, link later</option>}
                {openOrders.map((o) => (
                  <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>
                    {o.label}{o.partlyReceived ? " · partly received" : ""}
                  </option>
                ))}
              </select>
              {pickedOrder && (
                <button
                  type="button"
                  onClick={fillFromPO}
                  disabled={busy}
                  className="mt-2 rounded-md border border-border px-2.5 py-1 t-xs font-semibold text-t1 hover:bg-surface-2 disabled:opacity-40"
                >
                  Fill lines from PO <span className="font-normal text-faint">(structure only — you type the received qty)</span>
                </button>
              )}
              {poChoice === "PENDING" && (
                <p className="mt-1.5 t-micro text-faint">Stock still posts on lock; attach the PO later from the P.O.-pending list.</p>
              )}
            </div>
          )}

          {/* phones: a stacked card per line — the wide inline table can't be typed into at 390px */}
          <div className="mt-4 flex flex-col gap-2 md:hidden">
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={l.kind}
                    onChange={(e) => setLine(i, { kind: e.target.value as "fabric" | "trim", refId: 0, colour: "" })}
                    className={`${inp} w-full`}
                  >
                    <option value="fabric">Fabric</option>
                    <option value="trim">Trim/Acc</option>
                  </select>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} aria-label="Remove line" className="shrink-0 rounded-md p-1.5 text-faint active:text-danger">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <select value={l.refId} onChange={(e) => setLine(i, { refId: +e.target.value })} className={`${inp} mt-2 w-full`}>
                  <option value={0}>— pick {l.kind} —</option>
                  {(l.kind === "fabric" ? fabrics : trims).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {l.kind === "fabric" && (
                  <input list="challan-colours" value={l.colour} onChange={(e) => setLine(i, { colour: e.target.value })} placeholder="colour" className={`${inp} mt-2 w-full`} />
                )}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder={l.ordered ? `qty (ord ${l.ordered})` : "qty"} className={`${inp} w-full text-right tnum`} />
                  <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} className={`${inp} w-full`}>
                    <option value="">unit</option>
                    <option>MTR</option>
                    <option>KG</option>
                    <option>PCS</option>
                    <option>SET</option>
                  </select>
                  <input type="number" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="₹ rate" className={`${inp} w-full text-right tnum`} />
                </div>
                {l.kind === "fabric" && (
                  // Change 40 H2 — rolls (physically counted) + measured width in inches, both blank.
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input type="number" inputMode="numeric" value={l.rolls} onChange={(e) => setLine(i, { rolls: e.target.value })} placeholder="rolls (counted)" className={`${inp} w-full text-right tnum`} />
                    <input type="number" inputMode="decimal" value={l.widthInch} onChange={(e) => setLine(i, { widthInch: e.target.value })} placeholder="width (inch)" className={`${inp} w-full text-right tnum`} />
                  </div>
                )}
                {l.ordered && <p className="mt-1 t-micro text-faint">ordered {l.ordered}</p>}
              </div>
            ))}
          </div>

          {/* line table (desktop) */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">Type</th>
                  <th className="px-2 py-2 font-semibold">Item</th>
                  <th className="px-2 py-2 font-semibold">Colour</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 font-semibold">Unit</th>
                  <th className="px-2 py-2 text-right font-semibold">Rate</th>
                  {tab === "INWARD" && <th className="px-2 py-2 text-right font-semibold">Rolls</th>}
                  {tab === "INWARD" && <th className="px-2 py-2 text-right font-semibold">Width&quot;</th>}
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-hairline last:border-0">
                    <td className="px-2 py-1">
                      <select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as "fabric" | "trim", refId: 0, colour: "" })} className={inp}>
                        <option value="fabric">Fabric</option>
                        <option value="trim">Trim/Acc</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={l.refId} onChange={(e) => setLine(i, { refId: +e.target.value })} className={`${inp} min-w-[150px]`}>
                        <option value={0}>— pick {l.kind} —</option>
                        {(l.kind === "fabric" ? fabrics : trims).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      {l.kind === "fabric" ? (
                        <input list="challan-colours" value={l.colour} onChange={(e) => setLine(i, { colour: e.target.value })} placeholder="colour" className={`${inp} w-24`} />
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder={l.ordered ? "0" : "0"} className={`${inp} w-20 text-right tnum`} />
                      {l.ordered && <div className="mt-0.5 text-right t-micro text-faint">ord {l.ordered}</div>}
                    </td>
                    <td className="px-1 py-1">
                      <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} className={inp}>
                        <option value="">—</option>
                        <option>MTR</option><option>KG</option><option>PCS</option><option>SET</option>
                      </select>
                    </td>
                    <td className="px-1 py-1"><input type="number" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="₹" className={`${inp} w-16 text-right tnum`} /></td>
                    {tab === "INWARD" && (
                      <td className="px-1 py-1">{l.kind === "fabric" ? <input type="number" value={l.rolls} onChange={(e) => setLine(i, { rolls: e.target.value })} placeholder="—" className={`${inp} w-16 text-right tnum`} /> : <span className="text-faint">—</span>}</td>
                    )}
                    {tab === "INWARD" && (
                      <td className="px-1 py-1">{l.kind === "fabric" ? <input type="number" value={l.widthInch} onChange={(e) => setLine(i, { widthInch: e.target.value })} placeholder="—" className={`${inp} w-16 text-right tnum`} /> : <span className="text-faint">—</span>}</td>
                    )}
                    <td className="px-1 py-1 text-right"><button onClick={() => removeLine(i)} className="text-faint hover:text-danger"><X size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="challan-colours">{colours.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </div>
        </Card>

        {/* live summary + actions */}
        <Card className="min-w-0 p-5">
          <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">Summary</h3>
          <div className="space-y-2 t-sm">
            <div className="flex justify-between"><span className="text-muted">Direction</span><Badge tone={tab === "OUTWARD" ? "warn" : "ok"}>{tab === "OUTWARD" ? "Outward (−)" : "Inward (+)"}</Badge></div>
            <div className="flex justify-between"><span className="text-muted">Kind</span>{draftKind ? <Badge tone={KIND_TONE[draftKind]}>{draftKind}</Badge> : <span className="text-faint">—</span>}</div>
            {jobCardId > 0 && <div className="flex justify-between"><span className="text-muted">Job card</span><span className="font-semibold">{jobLabel(jobCardId)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">Lines</span><span className="font-bold tnum">{filled.length}</span></div>
            <div className="flex justify-between"><span className="text-muted">Total qty</span><span className="font-bold tnum">{num(totalQty)}</span></div>
            {tab === "INWARD" && totalRolls > 0 && <div className="flex justify-between"><span className="text-muted">Total rolls</span><span className="font-bold tnum">{totalRolls}</span></div>}
            {avgPerRoll != null && <div className="flex justify-between"><span className="text-muted">Avg / roll</span><span className="tnum text-t2">≈ {num(avgPerRoll, 1)}</span></div>}
            {totalValue != null && <div className="flex justify-between"><span className="text-muted">Total value</span><span className="font-bold tnum">{inr(Math.round(totalValue))}</span></div>}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <button onClick={() => save(true)} disabled={busy || !counterparty || filled.length === 0} className="rounded-lg bg-primary px-4 py-2 t-body font-semibold text-accent-on hover:opacity-90 disabled:opacity-40">
              {busy ? "Saving…" : "Lock & Post"}
            </button>
            <button onClick={() => save(false)} disabled={busy || !counterparty || filled.length === 0} className="rounded-lg border border-border px-4 py-2 t-body font-semibold text-t1 hover:bg-surface-2 disabled:opacity-40">
              Save draft
            </button>
          </div>
          
        </Card>
      </div>

      {/* Change 23 Part B: the busiest ledger in the tool finally gets real slicing —
          search, status/kind/counterparty filters, a date range and click-to-sort.
          The INWARD/OUTWARD tab stays; everything else narrows within it. */}
      <ChallanList rows={challans.filter((c) => c.direction === tab)} tab={tab} />
    </div>
  );
}

const KINDS = ["FABRIC", "TRIM", "COMBINED"];

function ChallanList({ rows, tab }: { rows: ChallanRow[]; tab: "INWARD" | "OUTWARD" }) {
  const parties = useMemo(
    () => [...new Set(rows.map((r) => r.counterparty))].filter((x) => x && x !== "—").sort(),
    [rows]
  );

  const filters: FilterDef<ChallanRow>[] = useMemo(
    () => [
      {
        key: "status",
        label: "statuses",
        // Voided challans are noise in the daily view — visible, but only on request.
        initial: "LIVE",
        options: [
          { value: "LIVE", label: "Draft + Locked" },
          { value: "DRAFT", label: "Draft" },
          { value: "LOCKED", label: "Locked" },
          { value: "VOID", label: "Void" },
        ],
        match: (r, v) => (v === "LIVE" ? r.status !== "VOID" : r.status === v),
      },
      { key: "kind", label: "kinds", options: KINDS.map((k) => ({ value: k, label: k })), match: (r, v) => r.kind === v },
      {
        key: "party",
        label: tab === "INWARD" ? "suppliers" : "vendors",
        options: parties.map((p) => ({ value: p, label: p })),
        match: (r, v) => r.counterparty === v,
      },
    ],
    [parties, tab]
  );

  const csv: CsvExport<ChallanRow> = {
    filename: "challans",
    columns: [
      { header: "challan_no", value: (c) => c.challanNo ?? `Draft #${c.id}` },
      { header: "status", value: (c) => c.status },
      { header: "kind", value: (c) => c.kind },
      { header: "challan_date", value: (c) => new Date(c.date) },
      { header: tab === "INWARD" ? "supplier" : "vendor", value: (c) => c.counterparty },
      { header: "si_no", value: (c) => c.jobCardSiNo },
      { header: "lines", value: (c) => c.lineCount },
      { header: "qty", value: (c) => c.totalQty },
    ],
  };

  const view = useTableView<ChallanRow>({
    id: "ch",
    rows,
    filters,
    search: (r) => [r.challanNo, r.counterparty, r.jobCardSiNo, r.note],
    date: (r) => r.date,
    sorts: {
      date: (r) => new Date(r.date),
      no: (r) => r.challanNo ?? "",
      status: (r) => r.status,
      party: (r) => r.counterparty,
      qty: (r) => r.totalQty,
    },
    defaultSort: { key: "date", dir: "desc" },
    sum: (r) => r.totalQty,
  });

  return (
    <Card className="mt-3.5 p-5">
      <h3 className="mb-3 t-body font-bold">{tab === "OUTWARD" ? "Outward" : "Inward"} challans</h3>
      <TableToolbar
        view={view}
        filters={filters}
        searchPlaceholder="Search challan no, party, SI, note…"
        dateLabel="Challan date"
        csv={csv}
      />
      {view.rows.length === 0 ? (
        <p className="py-6 text-center t-sm text-muted">
          {rows.length === 0 ? "No challans" : "No challans match these filters"}
        </p>
      ) : (
        <>
        <MobileCardList
          className="md:hidden"
          rows={view.rows}
          keyOf={(c) => c.id}
          renderCard={(c) => <ChallanCardItem c={c} tab={tab} />}
        />
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                <th className="px-2 py-2"><SortHeader view={view} sortKey="no">No / Status</SortHeader></th>
                <th className="px-2 py-2 font-semibold">Kind</th>
                <th className="px-2 py-2"><SortHeader view={view} sortKey="date">Date</SortHeader></th>
                <th className="px-2 py-2"><SortHeader view={view} sortKey="party">{tab === "INWARD" ? "Supplier" : "Vendor"}</SortHeader></th>
                <th className="px-2 py-2 font-semibold">Job SI</th>
                <th className="px-2 py-2 text-right font-semibold">Lines</th>
                <th className="px-2 py-2 text-right"><SortHeader view={view} sortKey="qty" align="right">Qty</SortHeader></th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((c) => (
                <ChallanRowItem key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Card>
  );
}

/** Phone card for one challan — the same identity + actions as the desktop row. */
function ChallanCardItem({ c, tab }: { c: ChallanRow; tab: "INWARD" | "OUTWARD" }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const dead = c.status === "VOID";
  async function doLock() {
    setBusy(true);
    try {
      await lockChallan({ id: c.id });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  }
  async function doVoid() {
    if (!(await confirm({ title: `Void ${c.challanNo ?? "challan"}?`, message: "This reverses its stock movement.", tone: "danger", confirmLabel: "Void" }))) return;
    setBusy(true);
    try {
      await voidChallan({ id: c.id });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className={`rounded-card bg-surface p-4 elev ${dead ? "opacity-55" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/challan-doc/${c.id}`} className="t-body font-bold text-primary-ink">
          {c.challanNo ?? `Draft #${c.id}`}
        </Link>
        <span className="flex items-center gap-1">
          {c.kind && <Badge tone={KIND_TONE[c.kind] ?? "default"}>{c.kind}</Badge>}
          <Badge tone={c.status === "LOCKED" ? "ok" : c.status === "VOID" ? "danger" : "warn"}>{c.status}</Badge>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 t-sm">
        <span className="tnum text-t3">{fmtDate(c.date)}</span>
        <span className="text-t2">{c.counterparty}</span>
        {c.jobCardSiNo && (
          <Link href={`/job-cards/${c.jobCardId}`} className="text-primary-ink">
            {c.jobCardSiNo}
          </Link>
        )}
        <span className={`tnum ${dead ? "line-through" : ""}`}>
          {c.lineCount} line{c.lineCount === 1 ? "" : "s"} · {num(c.totalQty)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {c.status === "DRAFT" && (
          <button onClick={doLock} disabled={busy} className="t-xs font-semibold text-primary-ink disabled:opacity-40">
            Lock &amp; post
          </button>
        )}
        {c.status === "LOCKED" && (
          <button onClick={doVoid} disabled={busy} className="t-xs font-semibold text-danger disabled:opacity-40">
            Void
          </button>
        )}
        <Link href={`/challan-doc/${c.id}`} className="ml-auto inline-flex items-center gap-1 t-xs font-medium text-t2">
          <Printer size={12} /> open
        </Link>
      </div>
    </div>
  );
}

function ChallanRowItem({ c }: { c: ChallanRow }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  async function doLock() { setBusy(true); try { await lockChallan({ id: c.id }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }
  async function doVoid() { if (!(await confirm({ title: `Void ${c.challanNo ?? "challan"}?`, message: "This reverses its stock movement.", tone: "danger", confirmLabel: "Void" }))) return; setBusy(true); try { await voidChallan({ id: c.id }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }
  const isDraft = c.status === "DRAFT";
  const dead = c.status === "VOID"; // Change 23 B: shown when asked for, always dimmed
  return (
    <tr className={`border-b border-hairline last:border-0 ${isDraft ? "bg-warn-soft" : ""} ${dead ? "opacity-55" : ""}`}>
      <td className="px-2 py-2">
        <Link href={`/challan-doc/${c.id}`} className="font-bold text-primary-ink hover:underline">{c.challanNo ?? `Draft #${c.id}`}</Link>{" "}
        <Badge tone={c.status === "LOCKED" ? "ok" : c.status === "VOID" ? "danger" : "warn"}>{c.status}</Badge>
      </td>
      <td className="px-2 py-2">{c.kind ? <Badge tone={KIND_TONE[c.kind] ?? "default"}>{c.kind}</Badge> : <span className="text-faint">—</span>}</td>
      <td className="px-2 py-2 text-t2 tnum">{fmtDate(c.date)}</td>
      <td className="px-2 py-2">{c.counterparty}</td>
      <td className="px-2 py-2">{c.jobCardSiNo ? <Link href={`/job-cards/${c.jobCardId}`} className="text-primary-ink hover:underline">{c.jobCardSiNo}</Link> : <span className="text-faint">—</span>}</td>
      <td className="px-2 py-2 text-right tnum">{c.lineCount}</td>
      <td className={`px-2 py-2 text-right font-semibold tnum ${dead ? "line-through" : ""}`}>{num(c.totalQty)}</td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          {c.status === "DRAFT" && <button onClick={doLock} disabled={busy} className="t-xs font-semibold text-primary-ink hover:underline disabled:opacity-40">Lock & post</button>}
          {c.status === "LOCKED" && <button onClick={doVoid} disabled={busy} className="t-xs font-semibold text-danger hover:underline disabled:opacity-40">Void</button>}
          <Link href={`/challan-doc/${c.id}`} className="inline-flex items-center gap-1 t-xs font-medium text-t2 hover:text-ink"><Printer size={12} /> open</Link>
        </div>
      </td>
    </tr>
  );
}
