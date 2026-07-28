import Link from "next/link";
import { db } from "@/lib/db";
import { traceGarment, traceLot } from "@/lib/trace";
import { Card, PageHeader, Badge, SearchInput } from "@/components/ui";
import { num, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Change 36 Part 8 — the lookup. Read-only: this answers "where did this come from" and
 * "where did that go", and never implies a lot-level stock balance, because there isn't
 * one — FabricColor.currentStock is a single scalar per (fabric, colour).
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let lot = null;
  let garment = null;

  if (query) {
    lot = await traceLot(query);
    if (!lot) {
      // Not a lot — try a DC number, an SI number, or a card id.
      const ev = await db.dispatchEvent.findFirst({ where: { dispatchNo: query }, select: { id: true } });
      if (ev) garment = await traceGarment({ dispatchEventId: ev.id });
      if (!garment) {
        const job = await db.jobCard.findFirst({
          where: { OR: [{ siNo: query }, ...(Number.isFinite(Number(query)) ? [{ id: Number(query) }] : [])] },
          select: { id: true },
        });
        if (job) garment = await traceGarment({ jobCardId: job.id });
      }
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="Trace" subtitle="Lot number, DC number or job card" />

      <form className="mb-4 max-w-md">
        <SearchInput name="q" defaultValue={query} placeholder="e.g. LOT-4471, DC-2026-018, SI-01" />
      </form>

      {query && !lot && !garment && (
        <Card className="p-6 text-center t-body text-muted">Nothing found for “{query}”</Card>
      )}

      {lot && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 t-body font-bold">Lot {lot.lotNo} · received</h3>
            {lot.received.length === 0 ? (
              <p className="t-sm text-muted">No inward line carries this lot.</p>
            ) : (
              lot.received.map((r, i) => (
                <div key={i} className="border-b border-hairline py-2 last:border-0 t-sm">
                  <Link href={`/challan-doc/${r.challanId}`} className="font-semibold text-primary-ink hover:underline">
                    {r.challanNo ?? `#${r.challanId}`}
                  </Link>
                  <span className="ml-2 text-t2">{r.supplier ?? "—"}</span>
                  <span className="ml-2 text-t3">{r.fabric ?? "—"}</span>
                  <span className="float-right tnum">{num(r.qty, 2)}</span>
                  <div className="t-micro text-faint">{fmtDate(r.date)}</div>
                </div>
              ))
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 t-body font-bold">Consumed by</h3>
            {lot.consumed.length === 0 ? (
              <p className="t-sm text-muted">No lay records this lot yet.</p>
            ) : (
              lot.consumed.map((c, i) => (
                <div key={i} className="border-b border-hairline py-2 last:border-0 t-sm">
                  <Link href={`/job-cards/${c.jobCardId}`} className="font-semibold text-primary-ink hover:underline">
                    {c.siNo}
                  </Link>
                  <span className="ml-2 text-t3">layer {c.layerNo}</span>
                  <span className="float-right tnum">{num(c.qty)} pcs</span>
                  {c.dispatches.length > 0 && (
                    <div className="t-micro text-faint">
                      shipped on {c.dispatches.map((d) => d.dispatchNo ?? `#${d.id}`).join(", ")}
                    </div>
                  )}
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {garment && <TracePanelInline trace={garment} />}
    </div>
  );
}

function TracePanelInline({ trace }: { trace: NonNullable<Awaited<ReturnType<typeof traceGarment>>> }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className="t-body font-bold">
          <Link href={`/job-cards/${trace.jobCardId}`} className="text-primary-ink hover:underline">{trace.siNo}</Link>
        </h3>
        {trace.product && <span className="t-sm text-t2">{trace.product}</span>}
        {trace.inwardUnknown && <Badge tone="default">Inward challan unknown</Badge>}
      </div>

      <h4 className="mb-1 t-xs font-bold uppercase tracking-wide text-faint">Lays</h4>
      {trace.layers.map((l) => (
        <div key={l.layerId} className="border-b border-hairline py-1.5 last:border-0 t-sm">
          <b>{l.label || `Layer ${l.layerNo}`}</b>
          <span className="ml-2 text-t3">{l.colours.join(", ") || "—"}</span>
          <span className="ml-2 text-t2">{l.vendor ?? "—"}</span>
          {l.lotNo ? <Badge tone="ok" className="ml-2">lot {l.lotNo}</Badge> : <span className="ml-2 t-xs text-faint">no lot recorded</span>}
          <span className="float-right tnum">{num(l.qty)} pcs</span>
        </div>
      ))}

      <h4 className="mb-1 mt-3 t-xs font-bold uppercase tracking-wide text-faint">Received on</h4>
      {trace.challans.length === 0 ? (
        <p className="t-sm text-muted">
          No inward challan is linked to this card — common for fabric bought to stock rather than against the order.
        </p>
      ) : (
        trace.challans.map((c) => (
          <div key={c.challanId} className="border-b border-hairline py-1.5 last:border-0 t-sm">
            <Link href={`/challan-doc/${c.challanId}`} className="font-semibold text-primary-ink hover:underline">
              {c.challanNo ?? `#${c.challanId}`}
            </Link>
            <span className="ml-2 text-t2">{c.supplier ?? "—"}</span>
            {c.poNumber && <span className="ml-2 text-t3">{c.poNumber}</span>}
            <div className="t-micro text-faint">
              {c.lots.map((l) => `${l.fabric ?? "—"}${l.lotNo ? ` · lot ${l.lotNo}` : ""}${l.shadeRef ? ` · shade ${l.shadeRef}` : ""}`).join(" | ")}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}
