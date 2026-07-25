"use client";

import { inputClass } from "@/components/ui";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createChallan, addChallanLine, lockChallan, voidChallan } from "@/lib/actions";
import { Card, Badge } from "@/components/ui";
import { num, inr, fmtDate } from "@/lib/format";
import { Plus, X, Printer } from "lucide-react";

type Opt = { id: number; name: string };
type JobOpt = { id: number; label: string };
type ChallanRow = {
  id: number; direction: string; status: string; kind: string | null; challanNo: string | null; date: Date;
  counterparty: string; jobCardId: number | null; jobCardSiNo: string | null;
  note: string | null; lineCount: number; totalQty: number; totalValue: number | null;
};
type Line = { kind: "fabric" | "trim"; refId: number | 0; colour: string; qty: string; unit: string; rate: string; note: string };

const emptyLine = (): Line => ({ kind: "fabric", refId: 0, colour: "", qty: "", unit: "", rate: "", note: "" });
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
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);

  const partyOptions = tab === "INWARD" ? suppliers : vendors;
  const jobLabel = (id: number) => jobCards.find((j) => j.id === id)?.label ?? "";

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

  // Live derived kind + the "attach a job card" warning (Change 17 Part C).
  const draftKind = kindOf(filled.some((l) => l.kind === "fabric"), filled.some((l) => l.kind === "trim"));
  const needsJobCard = (draftKind === "TRIM" || draftKind === "COMBINED") && !jobCardId;

  const shownChallans = challans.filter((c) => c.direction === tab);

  async function save(lockAfter: boolean) {
    if (!counterparty || filled.length === 0) return;
    setBusy(true);
    try {
      const { id } = await createChallan({
        direction: tab,
        supplierId: tab === "INWARD" ? counterparty : null,
        vendorId: tab === "OUTWARD" ? counterparty : null,
        jobCardId: jobCardId || null,
        date: date || undefined,
        note: note.trim() || null,
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

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* entry */}
        <Card className="p-5">
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
              No job card attached to this challan. Trim / combined challans should name their job card.
            </div>
          )}

          {/* line table */}
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">Type</th>
                  <th className="px-2 py-2 font-semibold">Item</th>
                  <th className="px-2 py-2 font-semibold">Colour</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 font-semibold">Unit</th>
                  <th className="px-2 py-2 text-right font-semibold">Rate</th>
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
                    <td className="px-1 py-1"><input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="0" className={`${inp} w-20 text-right tnum`} /></td>
                    <td className="px-1 py-1">
                      <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} className={inp}>
                        <option value="">—</option>
                        <option>MTR</option><option>KG</option><option>PCS</option><option>SET</option>
                      </select>
                    </td>
                    <td className="px-1 py-1"><input type="number" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="₹" className={`${inp} w-16 text-right tnum`} /></td>
                    <td className="px-1 py-1 text-right"><button onClick={() => removeLine(i)} className="text-faint hover:text-danger"><X size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="challan-colours">{colours.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </div>
        </Card>

        {/* live summary + actions */}
        <Card className="p-5">
          <h3 className="mb-3 t-xs font-bold uppercase tracking-wide text-muted">Summary</h3>
          <div className="space-y-2 t-sm">
            <div className="flex justify-between"><span className="text-muted">Direction</span><Badge tone={tab === "OUTWARD" ? "warn" : "ok"}>{tab === "OUTWARD" ? "Outward (−)" : "Inward (+)"}</Badge></div>
            <div className="flex justify-between"><span className="text-muted">Kind</span>{draftKind ? <Badge tone={KIND_TONE[draftKind]}>{draftKind}</Badge> : <span className="text-faint">—</span>}</div>
            {jobCardId > 0 && <div className="flex justify-between"><span className="text-muted">Job card</span><span className="font-semibold">{jobLabel(jobCardId)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">Lines</span><span className="font-bold tnum">{filled.length}</span></div>
            <div className="flex justify-between"><span className="text-muted">Total qty</span><span className="font-bold tnum">{num(totalQty)}</span></div>
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
          <p className="mt-2 t-xs text-faint">Lock posts every line to the master inventory once ({tab === "OUTWARD" ? "subtracts" : "adds"}). Drafts touch nothing.</p>
        </Card>
      </div>

      {/* existing challans */}
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 t-body font-bold">{tab === "OUTWARD" ? "Outward" : "Inward"} challans <span className="font-medium text-faint">· {shownChallans.length}</span></h3>
        {shownChallans.length === 0 ? (
          <p className="py-6 text-center t-sm text-muted">No challans yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">No / Status</th>
                  <th className="px-2 py-2 font-semibold">Kind</th>
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">{tab === "INWARD" ? "Supplier" : "Vendor"}</th>
                  <th className="px-2 py-2 font-semibold">Job SI</th>
                  <th className="px-2 py-2 text-right font-semibold">Lines</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {shownChallans.map((c) => (
                  <ChallanRowItem key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ChallanRowItem({ c }: { c: ChallanRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function doLock() { setBusy(true); try { await lockChallan({ id: c.id }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }
  async function doVoid() { if (!confirm(`Void ${c.challanNo} and reverse its stock?`)) return; setBusy(true); try { await voidChallan({ id: c.id }); router.refresh(); } catch (e) { alert((e as Error).message); setBusy(false); } }
  const isDraft = c.status === "DRAFT";
  return (
    <tr className={`border-b border-hairline last:border-0 ${isDraft ? "bg-warn-soft" : ""}`}>
      <td className="px-2 py-2">
        <Link href={`/challan-doc/${c.id}`} className="font-bold text-primary-ink hover:underline">{c.challanNo ?? `Draft #${c.id}`}</Link>{" "}
        <Badge tone={c.status === "LOCKED" ? "ok" : c.status === "VOID" ? "danger" : "warn"}>{c.status}</Badge>
        {isDraft && <div className="mt-0.5 t-micro text-faint">number assigned on lock</div>}
      </td>
      <td className="px-2 py-2">{c.kind ? <Badge tone={KIND_TONE[c.kind] ?? "default"}>{c.kind}</Badge> : <span className="text-faint">—</span>}</td>
      <td className="px-2 py-2 text-t2 tnum">{fmtDate(c.date)}</td>
      <td className="px-2 py-2">{c.counterparty}</td>
      <td className="px-2 py-2">{c.jobCardSiNo ? <Link href={`/job-cards/${c.jobCardId}`} className="text-primary-ink hover:underline">{c.jobCardSiNo}</Link> : <span className="text-faint">—</span>}</td>
      <td className="px-2 py-2 text-right tnum">{c.lineCount}</td>
      <td className="px-2 py-2 text-right font-semibold tnum">{num(c.totalQty)}</td>
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
