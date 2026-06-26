"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Zap, Check, AlertTriangle } from "lucide-react";
import { createProductionOrder } from "@/lib/actions";
import type { ProductOption } from "@/lib/production";
import { num } from "@/lib/format";

const URGENCIES = ["MODERATE", "URGENT", "V URGENT"];

export function NewOrderForm({ products }: { products: ProductOption[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProductOption | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(0);
  const [urgency, setUrgency] = useState("MODERATE");
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<{ orderNo: string; status: string } | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.skuCode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, products]);

  function pick(p: ProductOption) {
    setPicked(p);
    setQuery(p.skuCode);
    setOpen(false);
    setTarget(Math.round(2 * p.suggestedSale));
    setBlocked(null);
  }

  async function save(force = false) {
    if (!picked) return;
    setSaving(true);
    try {
      const res = await createProductionOrder({
        productId: picked.id,
        targetQty: target,
        avgMonthlySale: picked.suggestedSale,
        urgency,
        force,
      });
      if (res.duplicate) {
        setBlocked({ orderNo: res.existingOrderNo, status: res.existingStatus });
        setSaving(false);
        return;
      }
      router.push("/production-orders");
    } catch (e) {
      setSaving(false);
      alert("Could not save: " + (e as Error).message);
    }
  }

  const dup = picked?.hasActiveOrder || !!blocked;

  return (
    <div>
      <Link href="/production-orders" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Production Orders
      </Link>

      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">New Production Order</h1>
          <p className="mt-0.5 text-[12px] text-muted">Target defaults to 2× monthly sale · duplicates are checked before saving</p>
        </div>
        <button
          onClick={() => save(false)}
          disabled={!picked || saving || (dup && !blocked)}
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Create order"}
        </button>
      </div>

      <div className="grid grid-cols-[1.25fr_1fr] gap-3.5">
        {/* form */}
        <div className="rounded-card border border-border bg-surface p-5">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-muted">Order details</h3>

          <div className="relative mb-3.5">
            <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">
              Product <span className="text-primary">— start typing the SKU or name</span>
            </label>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
                setBlocked(null);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="e.g. MAX POLO or TSH-MP-301"
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
                      <span className="font-bold">{m.skuCode}</span>
                      <span className="ml-2 text-faint">{m.name}</span>
                    </span>
                    {m.hasActiveOrder && <span className="text-[10px] font-bold text-danger">active order</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Avg Monthly Sale</label>
              <input
                readOnly
                value={picked ? `${num(picked.suggestedSale)} pc` : ""}
                placeholder="—"
                className={`w-full rounded-lg border px-3 py-2.5 text-[13px] font-semibold outline-none ${picked ? "border-indigo-200 bg-primary-soft" : "border-border bg-slate-50 text-faint"}`}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Target Qty (2× sale)</label>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(Math.max(0, +e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Urgency</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary">
                {URGENCIES.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-slate-600">Category</label>
              <input readOnly value={picked?.headCategory ?? ""} placeholder="—" className="w-full rounded-lg border border-border bg-slate-50 px-3 py-2.5 text-[13px] text-faint outline-none" />
            </div>
          </div>
        </div>

        {/* duplicate-check panel */}
        <div className="rounded-card border border-slate-800 bg-gradient-to-b from-[#0f1226] to-[#1b1f3b] p-5 text-indigo-50">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-indigo-300">Duplicate check</h3>

          {!picked ? (
            <div className="flex h-48 flex-col items-center justify-center text-center text-[12px] text-indigo-300/70">
              <Zap size={22} className="mb-2 opacity-60" />
              Pick a product — we check for an existing active order before you commit.
            </div>
          ) : dup ? (
            <div>
              <div className="flex items-center gap-2 text-[14px] font-bold text-rose-300">
                <AlertTriangle size={18} /> Active order already exists
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-indigo-200">
                <b className="text-white">{picked.name}</b> ({picked.skuCode}) already has order{" "}
                <b className="text-white">{blocked?.orderNo ?? picked.activeOrderNo}</b> in progress. Raising another would double the cut.
              </p>
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="mt-4 w-full rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12px] font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Create anyway (override)"}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-[14px] font-bold text-emerald-300">
                <Check size={18} /> Clear to order
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-indigo-200">
                No active order for <b className="text-white">{picked.skuCode}</b>. Target <b className="text-white">{num(target)} pc</b> = 2× the {num(picked.suggestedSale)}/mo run rate.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-3 rounded-card border border-emerald-200 bg-ok-soft px-4 py-3 text-[12.5px] text-emerald-800">
        <Zap size={18} className="shrink-0 text-emerald-600" />
        <span>
          The owner&apos;s two locked rules, enforced in software: order <b>2× the monthly sale</b>, and <b>never raise a duplicate</b> active order for the same article.
        </span>
      </div>
    </div>
  );
}
