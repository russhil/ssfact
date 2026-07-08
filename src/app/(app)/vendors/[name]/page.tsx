import Link from "next/link";
import { notFound } from "next/navigation";
import { getVendorByName, getVendorLayers, getVendorChallans, type VendorLayer } from "@/lib/masters";
import { jobItem, jobStyle } from "@/lib/job-display";
import { Card, Badge } from "@/components/ui";
import { VendorDispatchLog, type VendorDispatchEvent } from "@/components/vendor-dispatch-log";
import { num, pct, fmtDate } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const orderSizes = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
};

export default async function VendorDetail({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const vendorName = decodeURIComponent(name);
  const vendor = await getVendorByName(vendorName);
  if (!vendor) notFound();

  const [layers, challans] = await Promise.all([getVendorLayers(vendor.id), getVendorChallans(vendor.id)]);

  // roll-ups across this vendor's layers
  const totalCut = layers.reduce((a, l) => a + l.cells.reduce((x, c) => x + c.qty, 0), 0);

  // dedupe dispatch events across all the vendor's layers → the vendor dispatch log
  const eventMap = new Map<number, VendorDispatchEvent>();
  for (const l of layers) {
    for (const e of l.dispatches) {
      if (eventMap.has(e.id)) continue;
      eventMap.set(e.id, {
        id: e.id,
        date: e.date.toISOString(),
        reason: e.reason,
        qty: e.qty,
        challan: e.challan,
        siNo: l.jobCard.siNo,
        jobCardId: l.jobCardId,
        layerIds: e.layers.map((x) => x.id),
        layerLabels: e.layers.map((x) => x.label || `L${x.layerNo}`),
        cells: e.lines.map((ln) => `${ln.colour ? ln.colour + " " : ""}${ln.size}:${num(ln.qty)}`),
      });
    }
  }
  const events = [...eventMap.values()].sort((a, b) => b.date.localeCompare(a.date));
  const totalDispatched = events.reduce((a, e) => a + e.qty, 0);
  const layerFilterOpts = layers.map((l) => ({ id: l.id, label: `${l.jobCard.siNo} · ${l.label || `L${l.layerNo}`}` }));

  return (
    <div className="p-6">
      <Link href="/vendors" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Vendors
      </Link>
      <div className="mb-1 flex items-center gap-2.5">
        <h1 className="text-[22px] font-bold tracking-tight">{vendor.name}</h1>
        <Badge tone={vendor.kind === "INHOUSE" ? "ok" : "default"}>{vendor.kind === "INHOUSE" ? "In-house" : "External"}</Badge>
      </div>
      <p className="mb-5 text-[13px] text-muted">
        {layers.length} layer{layers.length === 1 ? "" : "s"} issued · {num(totalCut)} cut · {num(totalDispatched)} dispatched · {pct(totalCut ? totalDispatched / totalCut : 0)} returned
      </p>

      {/* layer-by-layer */}
      {layers.length === 0 ? (
        <Card className="p-6 text-center text-[13px] text-muted">No cutting layers issued to this vendor yet.</Card>
      ) : (
        <div className="space-y-3">
          {layers.map((l) => (
            <LayerCard key={l.id} l={l} />
          ))}
        </div>
      )}

      {/* dispatch log (filterable by layer) */}
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 text-[13px] font-bold">Dispatch Log <span className="font-medium text-faint">· finished garments returned</span></h3>
        <VendorDispatchLog events={events} layers={layerFilterOpts} />
      </Card>

      {/* materials challans (unchanged) */}
      {challans.length > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">Materials Challans <span className="font-medium text-faint">· {challans.length}</span></h3>
          <div className="space-y-0">
            {challans.map((c) => (
              <Link key={c.id} href={`/challan-doc/${c.id}`} className="flex items-center justify-between border-b border-slate-50 py-2 text-[12px] last:border-0 hover:opacity-80">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-primary-ink">{c.challanNo ?? `Draft #${c.id}`}</span>
                  <Badge tone={c.status === "LOCKED" ? "ok" : c.status === "VOID" ? "danger" : "default"}>{c.status}</Badge>
                  <span className="text-faint tnum">{fmtDate(c.date)}</span>
                </span>
                <span className="font-semibold tnum">{num(c.totalQty)} · {c.lineCount} lines</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function LayerCard({ l }: { l: VendorLayer }) {
  const sizes = [...new Set(l.cells.map((c) => c.size))].sort(orderSizes);
  const colours = [...new Set(l.cells.map((c) => c.colour))].sort();
  const cell = (s: string, c: string) => l.cells.find((x) => x.size === s && x.colour === c)?.qty ?? 0;
  const cut = l.cells.reduce((a, c) => a + c.qty, 0);
  // dispatched against this layer = Σ of event totals that touch it (event may span layers)
  const dispatched = l.dispatches.reduce((a, e) => a + e.qty, 0);
  const multi = l.dispatches.some((e) => e.layers.length > 1);
  const balance = cut - dispatched;
  const issued = [
    l.fabricMtr != null ? `${num(l.fabricMtr)} mtr` : null,
    l.rolls != null ? `${num(l.rolls)} rolls` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="flex items-center gap-2">
          <Link href={`/job-cards/${l.jobCardId}`} className="font-bold text-primary-ink hover:underline">{l.jobCard.siNo}</Link>
          <span className="text-slate-600">{jobItem(l.jobCard)}</span>
          <span className="text-faint">{jobStyle(l.jobCard)}</span>
          <Badge tone="default">{l.label || `Layer ${l.layerNo}`}</Badge>
          {l.cuttingMaster && <span className="text-faint">cut: {l.cuttingMaster.name}</span>}
        </span>
        <span className="text-faint">{issued}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-center text-[12px]">
          <thead>
            <tr className="text-[10px] font-bold text-faint">
              <th className="px-2 py-1 text-left">Colour \ Size</th>
              {sizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
              <th className="px-2 py-1 text-primary-ink">Total</th>
            </tr>
          </thead>
          <tbody>
            {colours.map((c) => (
              <tr key={c || "—"} className="border-t border-slate-50">
                <td className="px-2 py-1 text-left font-semibold text-slate-600">{c || "—"}</td>
                {sizes.map((s) => <td key={s} className="px-2 py-1 tnum">{cell(s, c) || ""}</td>)}
                <td className="px-2 py-1 font-bold text-primary-ink tnum">{num(sizes.reduce((a, s) => a + cell(s, c), 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[12px]">
        <span>Cut <b className="tnum">{num(cut)}</b></span>
        <span>Dispatched <b className="tnum">{num(dispatched)}</b>{multi && <span className="text-faint"> (incl. multi-layer events)</span>}</span>
        <span>Balance <b className={`tnum ${balance < 0 ? "text-emerald-600" : balance > 0 ? "text-amber-600" : ""}`}>{num(balance)}</b></span>
      </div>
    </Card>
  );
}
