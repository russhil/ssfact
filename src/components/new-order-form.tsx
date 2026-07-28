"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, AlertTriangle } from "lucide-react";
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
      <Link href="/production-orders" className="mb-4 inline-flex items-center gap-1.5 t-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Production Orders
      </Link>

      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="t-title font-bold tracking-tight">New Production Order</h1>
        </div>
        <button
          onClick={() => save(false)}
          disabled={!picked || saving || (dup && !blocked)}
          className="rounded-lg bg-primary px-4 py-2 t-body font-semibold text-accent-on shadow-sm transition hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Create order"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[1.25fr_1fr]">
        {/* form */}
        <div className="min-w-0 rounded-card border border-border bg-surface p-5">
          <h3 className="mb-4 t-xs font-bold uppercase tracking-wide text-muted">Order details</h3>

          <div className="relative mb-3.5">
            <label className="mb-1.5 block t-xs font-semibold text-t1">
              Product
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
              className="w-full rounded-lg border border-primary px-3 py-2.5 t-body font-semibold outline-none ring-2 ring-accent/15"
            />
            {open && matches.length > 0 && (
              <div className="absolute left-0 right-0 top-[68px] z-10 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left t-sm hover:bg-primary-soft"
                  >
                    <span>
                      <span className="font-bold">{m.skuCode}</span>
                      <span className="ml-2 text-faint">{m.name}</span>
                    </span>
                    {m.hasActiveOrder && <span className="t-micro font-bold text-danger">active order</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Avg Monthly Sale</label>
              <input
                readOnly
                value={picked ? `${num(picked.suggestedSale)} pc` : ""}
                placeholder="—"
                className={`w-full rounded-lg border px-3 py-2.5 t-body font-semibold outline-none ${picked ? "border-accent-soft bg-primary-soft" : "border-border bg-surface-2 text-faint"}`}
              />
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Target Qty (2× sale)</label>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(Math.max(0, +e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2.5 t-body font-semibold outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Urgency</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2.5 t-body outline-none focus:border-primary">
                {URGENCIES.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block t-xs font-semibold text-t1">Category</label>
              <input readOnly value={picked?.headCategory ?? ""} placeholder="—" className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 t-body text-faint outline-none" />
            </div>
          </div>
        </div>

        {/* duplicate-check panel */}
        <div className="panel-invert rounded-card p-5">
          <h3 className="mb-4 t-xs font-bold uppercase tracking-wide text-t3">Duplicate check</h3>

          {!picked ? (
            <div className="flex h-48 flex-col items-center justify-center text-center t-sm text-t3">
              Select a product.
            </div>
          ) : dup ? (
            <div>
              <div className="flex items-center gap-2 t-head font-bold text-danger">
                <AlertTriangle size={18} /> Active order already exists
              </div>
              <p className="mt-2 t-sm leading-relaxed text-t2">
                <b className="text-t1">{picked.name}</b> ({picked.skuCode}) already has order{" "}
                <b className="text-t1">{blocked?.orderNo ?? picked.activeOrderNo}</b> in progress.
              </p>
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="mt-4 w-full rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 t-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Create anyway (override)"}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 t-head font-bold text-ok">
                <Check size={18} /> Clear to order
              </div>
              <p className="mt-2 t-sm leading-relaxed text-t2">
                No active order for <b className="text-t1">{picked.skuCode}</b>. Target <b className="text-t1">{num(target)} pc</b> = 2× the {num(picked.suggestedSale)}/mo run rate.
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
