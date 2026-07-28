import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getVendorWork, getCuttingWork, getTrimsWork } from "@/lib/my-work";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge } from "@/components/ui";
import { STAGE_LABEL, stageTone } from "@/lib/job-labels";
import { num, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Change 36 Part 9 — one route, the lens chosen by who is asking.
 *
 * Phone-first: one column, big tap targets, and only what that person can act on. No new
 * tables and no new permissions — this is the same data everyone else already sees,
 * filtered.
 */
export default async function MyWorkPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  if (me.role === "VENDOR") {
    const grouped = await getVendorWork(me.vendor ?? "");
    const stages = Object.keys(grouped) as (keyof typeof grouped)[];
    const total = stages.reduce((a, s) => a + (grouped[s]?.length ?? 0), 0);

    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="My work" subtitle={`${num(total)} open card${total === 1 ? "" : "s"}`} />
        {total === 0 && <Card className="p-6 text-center t-body text-muted">Nothing open right now</Card>}
        {stages.map((st) => (
          <div key={st} className="mb-4">
            <h3 className="mb-2 t-sm font-bold uppercase tracking-wide text-faint">{STAGE_LABEL[st] ?? st}</h3>
            {(grouped[st] ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/job-cards/${c.id}`}
                className="mb-2 block rounded-xl border border-border bg-surface p-4 active:scale-[0.99]"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="t-body font-bold text-primary-ink">{c.siNo}</span>
                  <Badge tone={stageTone(c.stage)}>{STAGE_LABEL[c.stage] ?? c.stage}</Badge>
                </div>
                {c.item && <p className="t-sm text-t2">{c.item}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 t-sm">
                  <span className="tnum"><b>{num(c.balance)}</b> to return</span>
                  <span className="tnum text-t3">{num(c.dispatchedQty)} / {num(c.cutQty)} done</span>
                  {c.plannedEtd && (
                    <span className={c.overdue ? "font-semibold text-danger" : "text-t3"}>
                      {c.overdue ? `${Math.abs(c.daysToEtd ?? 0)}d overdue` : `due ${fmtDate(c.plannedEtd)}`}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (me.role === "TRIMS") {
    const w = await getTrimsWork();
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="My work" subtitle="Trims" />
        <Card className="mb-3.5 p-4">
          <h3 className="mb-2 t-body font-bold">Challans to complete</h3>
          {w.pendingChallans.length === 0 ? (
            <p className="t-sm text-muted">Nothing in draft.</p>
          ) : (
            w.pendingChallans.map((c) => (
              <Link key={c.id} href={`/challans`} className="block border-b border-hairline py-2.5 last:border-0 t-sm">
                <b className="text-primary-ink">{c.challanNo ?? `#${c.id}`}</b>
                <span className="ml-2 text-t3">{c.direction.toLowerCase()}</span>
                <span className="float-right tnum text-t2">{c.lines} line{c.lines === 1 ? "" : "s"}</span>
                <div className="t-micro text-faint">{fmtDate(c.date)}</div>
              </Link>
            ))
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 t-body font-bold">Below reorder level</h3>
          {w.belowReorder.length === 0 ? (
            <p className="t-sm text-muted">Everything is above its trigger.</p>
          ) : (
            w.belowReorder.map((t) => (
              <Link key={t.id} href={`/trims/${t.id}`} className="block border-b border-hairline py-2.5 last:border-0 t-sm">
                <b>{t.name}</b>
                {t.colour && <span className="ml-1.5 text-t3">{t.colour}</span>}
                <span className="float-right tnum">
                  {num(t.currentStock, 2)} / {num(t.reorderLevel, 2)} {t.unit}
                </span>
              </Link>
            ))
          )}
        </Card>
      </div>
    );
  }

  // ADMIN / STAFF — the cutting lens. A filtered view, not a role: there is no CUTTING
  // role and CuttingMaster has no User link, so the master picks their own name.
  const masters = await db.cuttingMaster.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } });
  const layers = await getCuttingWork();

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Cutting" subtitle={`${num(layers.length)} recent lays on active cards`} />
      {layers.length === 0 ? (
        <Card className="p-6 text-center t-body text-muted">No open lays</Card>
      ) : (
        layers.map((l) => (
          <Link
            key={l.layerId}
            href={`/job-cards/${l.jobCardId}`}
            className="mb-2 block rounded-xl border border-border bg-surface p-4 active:scale-[0.99]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="t-body font-bold text-primary-ink">{l.siNo}</span>
              <span className="t-sm text-t3">{l.label || `Layer ${l.layerNo}`}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 t-sm">
              <span className="tnum"><b>{num(l.qty)}</b> pcs</span>
              <span className="tnum text-t3">
                issued {l.issued != null ? num(l.issued, 2) : "—"} · used {l.used != null ? num(l.used, 2) : "—"}
              </span>
              {l.master && <span className="text-t2">{l.master}</span>}
              {l.cutDate && <span className="text-t3">{fmtDate(l.cutDate)}</span>}
            </div>
          </Link>
        ))
      )}
      {masters.length > 0 && (
        <p className="mt-3 t-xs text-t3">Cutting masters: {masters.map((m) => m.name).join(" · ")}</p>
      )}
    </div>
  );
}
