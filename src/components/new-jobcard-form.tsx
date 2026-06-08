"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJobCard } from "@/lib/actions";
import type { StyleOption } from "@/lib/inventory";
import { num, inr } from "@/lib/format";
import { Zap, Check, AlertTriangle, ArrowLeft } from "lucide-react";

const SIZE_RATIO: [string, number][] = [
  ["S", 0.08], ["M", 0.17], ["L", 0.25], ["XL", 0.25], ["2XL", 0.17], ["3XL", 0.08],
];

export function NewJobCardForm({
  styles,
  vendors,
  masters,
}: {
  styles: StyleOption[];
  vendors: string[];
  masters: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<StyleOption | null>(null);
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(
    vendors.find((v) => v === "Pebble") ?? vendors.find((v) => v !== "Unassigned") ?? vendors[0] ?? ""
  );
  const [master, setMaster] = useState(masters.find((m) => m.includes("Attri")) ?? masters[0] ?? "");
  const [cutQty, setCutQty] = useState(1200);
  const [etd, setEtd] = useState("");
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return styles
      .filter((s) => s.styleNo.toLowerCase().includes(q) || s.itemDesc.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, styles]);

  const required = picked?.avgConsumption ? cutQty * picked.avgConsumption : null;
  const available = picked?.fabricAvailable ?? null;
  const enough = required != null && available != null ? available >= required : null;
  const leftover = required != null && available != null ? available - required : null;
  const usedAfter = required != null && available != null && available > 0 ? required / available : null;

  const sizes = SIZE_RATIO.map(([sz, r], i) => {
    const q = i < SIZE_RATIO.length - 1 ? Math.round(cutQty * r) : null;
    return { sz, q };
  });
  let run = 0;
  const sizeRow = sizes.map((s, i) => {
    const q = s.q ?? cutQty - run;
    run += s.q ?? 0;
    return { sz: s.sz, q };
  });

  function pick(s: StyleOption) {
    setPicked(s);
    setQuery(s.styleNo);
    setOpen(false);
  }

  async function save() {
    if (!picked) return;
    setSaving(true);
    try {
      const { slug } = await createJobCard({
        styleId: picked.id,
        vendorName: vendor,
        cuttingMaster: master,
        cutQty,
        plannedEtd: etd || undefined,
      });
      router.push(`/job-cards/${slug}`);
    } catch (e) {
      setSaving(false);
      alert("Could not save: " + (e as Error).message);
    }
  }

  return (
    <div>
      <Link href="/job-cards" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Job Cards
      </Link>

      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">New Job Card</h1>
          <p className="mt-0.5 text-[12px] text-muted">Auto-assigned SI · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
        </div>
        <button
          onClick={save}
          disabled={!picked || saving}
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Job Card"}
        </button>
      </div>

      <div className="grid grid-cols-[1.25fr_1fr] gap-3.5">
        {/* form */}
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-muted">Order details</h3>

          {/* style autocomplete */}
          <div className="relative mb-3.5">
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">
              Style No <span className="text-primary">— start typing, we find it</span>
            </label>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="e.g. TP-TRUMP"
              className="w-full rounded-lg border border-primary px-3 py-2.5 text-[13px] font-semibold outline-none ring-2 ring-indigo-100"
            />
            {open && matches.length > 0 && (
              <div className="absolute left-0 right-0 top-[68px] z-10 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] hover:bg-primary-soft"
                  >
                    <span>
                      <span className="font-bold">{m.styleNo}</span>
                      <span className="ml-2 text-faint">{m.itemDesc}</span>
                    </span>
                    <span className="font-bold text-emerald-600">{inr(m.mrp)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* autofilled fields */}
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Item Description" value={picked?.itemDesc ?? ""} auto={!!picked} />
            <Field label="MRP" value={picked ? inr(picked.mrp) : ""} auto={!!picked} />
            <Field label="Fabric" value={picked?.fabricName ?? ""} auto={!!picked} />
            <Field
              label="Avg Consumption"
              value={picked?.avgConsumption ? `${picked.avgConsumption} ${picked.unit.toLowerCase()}/pc` : picked ? "not set" : ""}
              auto={!!picked}
            />
          </div>

          {/* manual fields */}
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Vendor</label>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary">
                {vendors.map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Cutting Master</label>
              <select value={master} onChange={(e) => setMaster(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary">
                {masters.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Cut Qty (pcs)</label>
              <input type="number" value={cutQty} onChange={(e) => setCutQty(Math.max(0, +e.target.value))} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Planned ETD</label>
              <input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary" />
            </div>
          </div>

          {/* size preview */}
          <div className="mt-3.5">
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">
              Size Ratio · Total <span className="font-bold text-primary-ink">{num(cutQty)} pcs</span>
            </label>
            <div className="grid grid-cols-7 gap-1.5 text-center">
              {sizeRow.map((s) => (
                <div key={s.sz}>
                  <div className="text-[10px] font-bold text-faint">{s.sz}</div>
                  <div className="mt-1 rounded-md border border-border bg-slate-50 py-1.5 text-[12px] font-bold tnum">{num(s.q)}</div>
                </div>
              ))}
              <div>
                <div className="text-[10px] font-bold text-primary-ink">Total</div>
                <div className="mt-1 rounded-md bg-primary-soft py-1.5 text-[12px] font-bold text-primary-ink tnum">{num(cutQty)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* live calc panel */}
        <div className="rounded-card border border-slate-800 bg-gradient-to-b from-[#0f1226] to-[#1b1f3b] p-5 text-indigo-50">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-indigo-300">Live fabric requirement</h3>

          {!picked ? (
            <div className="flex h-56 flex-col items-center justify-center text-center text-[12px] text-indigo-300/70">
              <Zap size={22} className="mb-2 opacity-60" />
              Pick a style — we&apos;ll pull its average and check live stock for you.
            </div>
          ) : (
            <>
              <Row k="Cut Qty" v={`${num(cutQty)} pc`} />
              <Row k="Avg consumption" v={picked.avgConsumption ? `× ${picked.avgConsumption} ${picked.unit.toLowerCase()}` : "not set"} />
              <div className="flex items-end justify-between border-b border-white/10 py-2.5">
                <span className="text-[13px] text-indigo-200">Fabric required</span>
                <span className="text-[30px] font-extrabold text-white tnum">
                  {required != null ? num(required, 0) : "—"} <span className="text-[14px]">{picked.unit.toLowerCase()}</span>
                </span>
              </div>

              <div className="mt-4">
                <Row k={`${picked.fabricName ?? "Fabric"} — in stock`} v={available != null ? `${num(available)} ${picked.unit.toLowerCase()}` : "—"} border={false} />
                <div className="my-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${enough === false ? "bg-gradient-to-r from-rose-400 to-rose-500" : "bg-gradient-to-r from-emerald-400 to-cyan-400"}`}
                    style={{ width: `${Math.min(100, (usedAfter ?? 0) * 100)}%` }}
                  />
                </div>
                {leftover != null && (
                  <div className="flex justify-between text-[11px] text-indigo-200/80">
                    <span>
                      after issue:{" "}
                      <b className={leftover >= 0 ? "text-emerald-300" : "text-rose-300"}>
                        {num(Math.abs(leftover))} {picked.unit.toLowerCase()} {leftover >= 0 ? "left" : "short"}
                      </b>
                    </span>
                    <span>{usedAfter != null ? `${Math.min(100, Math.round(usedAfter * 100))}% used` : ""}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[13px]">
                <span className="text-indigo-200">Stock check</span>
                {enough == null ? (
                  <span className="text-indigo-300">—</span>
                ) : enough ? (
                  <span className="flex items-center gap-1.5 font-bold text-emerald-300"><Check size={15} /> Enough fabric</span>
                ) : (
                  <span className="flex items-center gap-1.5 font-bold text-rose-300"><AlertTriangle size={15} /> Short — raise indent</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* magic callout */}
      <div className="mt-3.5 flex items-center gap-3 rounded-card border border-emerald-200 bg-ok-soft px-4 py-3 text-[12.5px] text-emerald-800">
        <Zap size={18} className="shrink-0 text-emerald-600" />
        <span>
          In the Excel, this job card meant retyping style, item, MRP, fabric &amp; average across <b>4 different sheets</b> by hand.
          Here you typed a few characters — and stock auto-checked <b>before</b> you committed a single metre.
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, auto }: { label: string; value: string; auto: boolean }) {
  return (
    <div className="relative">
      <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">{label}</label>
      <input
        readOnly
        value={value}
        placeholder="—"
        className={`w-full rounded-lg border px-3 py-2.5 text-[13px] font-semibold outline-none ${
          auto ? "border-indigo-200 bg-primary-soft" : "border-border bg-slate-50 text-faint"
        }`}
      />
      {auto && (
        <span className="absolute right-2.5 top-[31px] rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-primary-ink">auto</span>
      )}
    </div>
  );
}

function Row({ k, v, border = true }: { k: string; v: string; border?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2.5 text-[13px] ${border ? "border-b border-white/10" : ""}`}>
      <span className="text-indigo-200">{k}</span>
      <span className="font-bold tnum">{v}</span>
    </div>
  );
}
