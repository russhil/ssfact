import Link from "next/link";
import { notFound } from "next/navigation";
import { getFabricStock, getFabricLedger } from "@/lib/inventory";
import { getFabricSourcing, getSuppliers } from "@/lib/masters";
import { getCurrentUser, canSeeCost as canSee } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { FabricMasterForm } from "@/components/fabric-master-form";
import { SourcingPanel } from "@/components/sourcing-panel";
import { StockAdjust } from "@/components/stock-adjust";
import { ReorderLevel } from "@/components/reorder-level";
import { num, pct, fmtDate } from "@/lib/format";
import { jobItem } from "@/lib/job-display";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FabricDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fabricId = Number(id);
  const stock = (await getFabricStock()).find((s) => s.id === fabricId);
  if (!stock) notFound();
  const ledger = await getFabricLedger(fabricId);
  const u = await getCurrentUser();
  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";
  const canSeeCost = canSee(u); // sourcing rates are cost data — owner only
  const sourcing = canSeeCost ? await getFabricSourcing(fabricId) : null;
  // Change 18 Part D: the supplier picker draws on the ONE shared Supplier master.
  const supplierOptions = canEdit
    ? (await getSuppliers()).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))
    : [];

  const attrs: [string, string][] = [
    ["Unit", stock.unit],
    ["Preset GSM", stock.gsm != null ? num(stock.gsm) : "—"],
    ["Preset roll width", stock.rollWidth != null ? num(stock.rollWidth) : "—"],
    ["Form", stock.form ?? "—"],
    ["Est. price", stock.ratePerUnit != null ? `${num(stock.ratePerUnit)} /${stock.unit.toLowerCase()}` : "—"],
    ["Suppliers", stock.suppliers.length ? stock.suppliers.map((s) => s.name).join(", ") : "—"],
  ];

  return (
    <div className="p-6">
      <Link href="/inventory" className="mb-4 inline-flex items-center gap-1.5 t-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Inventory
      </Link>

      <div className="mb-5 flex items-center gap-2.5">
        <h1 className="t-display font-bold tracking-tight">{stock.name}</h1>
        <span className="t-sm text-faint">{stock.unit}</span>
        {stock.available <= 0 ? <Badge tone="danger">Indent</Badge> : stock.usedPct >= 0.85 ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
      </div>

      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Opening", num(stock.opening)],
          ["Issued", num(stock.issued)],
          ["Available", num(stock.available)],
          ["Utilisation", pct(stock.usedPct)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className={`mt-1.5 t-display font-extrabold tnum ${l === "Available" && stock.available <= 0 ? "text-danger" : ""}`}>{v}</div>
          </Card>
        ))}
      </div>

      {/* master attributes */}
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 t-body font-bold">Fabric Attributes</h3>
        <dl className="grid grid-cols-6 gap-x-6 gap-y-2.5 t-sm">
          {attrs.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="t-xs text-faint">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Change 18 Part E: sourcing history — estimate on the master, true rate on the PO */}
      {sourcing && (
        <SourcingPanel rates={sourcing.rates} pos={sourcing.pos} unit={stock.unit} poHref="/po" estimate={stock.ratePerUnit} />
      )}

      {/* per-colour stock */}
      {stock.colors.length > 0 && (
        <Card className="mt-3.5 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3 t-body font-bold">
            Stock by Colour <span className="font-medium text-faint">· {stock.colors.length} colours</span>
          </div>
          <table className="w-full t-sm">
            <thead>
              <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
                <th className="px-5 py-2.5 font-semibold">Colour</th>
                <th className="px-5 py-2.5 text-right font-semibold">Opening</th>
                <th className="px-5 py-2.5 text-right font-semibold">Current</th>
                <th className="px-5 py-2.5 text-right font-semibold">Reorder at</th>
                <th className="px-5 py-2.5 font-semibold">Utilisation</th>
                <th className="px-5 py-2.5 font-semibold">Status</th>
                {canEdit && <th className="px-5 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              {stock.colors.map((c) => {
                const w = Math.min(100, Math.max(0, c.usedPct * 100));
                return (
                  <tr key={c.id} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-2.5 font-semibold text-t1">{c.color}</td>
                    <td className="px-5 py-2.5 text-right text-t2 tnum">{num(c.opening)}</td>
                    <td className={`px-5 py-2.5 text-right font-bold tnum ${c.current <= 0 ? "text-danger" : ""}`}>{num(c.current)}</td>
                    {/* Change 25 Part E: the trigger sits beside the figure it guards. */}
                    <td className="px-5 py-2.5 text-right">
                      {canEdit ? (
                        <ReorderLevel fabricColorId={c.id} level={c.reorderLevel} unit={stock.unit} />
                      ) : (
                        <span className="t-xs text-t3 tnum">{c.reorderLevel == null ? "—" : num(c.reorderLevel, 2)}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-2">
                          <div className={`h-full rounded-full ${c.status === "Indent" ? "bg-danger" : c.status === "Low" ? "bg-warn" : "bg-primary"}`} style={{ width: `${w}%` }} />
                        </div>
                        <span className="tnum t-xs font-semibold">{pct(c.usedPct)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      {c.status === "Indent" ? <Badge tone="danger">Indent</Badge> : c.status === "Low" ? <Badge tone="warn">Low</Badge> : <Badge tone="ok">OK</Badge>}
                    </td>
                    {/* Change 22 Part E: ledger-backed correction with a reason, replacing
                        the silent setFabricColorStock overwrite. */}
                    {canEdit && (
                      <td className="px-5 py-2.5 text-right">
                        <StockAdjust
                          target={{ kind: "fabric", fabricId: stock.id, colour: c.color }}
                          name={`${stock.name} · ${c.color}`}
                          current={c.current}
                          unit={stock.unit}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {canEdit && (
        <FabricMasterForm
          fabricId={stock.id}
          unit={stock.unit}
          gsm={stock.gsm}
          rollWidth={stock.rollWidth}
          form={stock.form}
          ratePerUnit={stock.ratePerUnit}
          suppliers={stock.suppliers}
          supplierOptions={supplierOptions}
        />
      )}

      <Card className="mt-3.5 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 t-body font-bold">
          Stock Ledger
        </div>
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-semibold">Date</th>
              <th className="px-5 py-2.5 font-semibold">Type</th>
              <th className="px-5 py-2.5 font-semibold">Colour</th>
              <th className="px-5 py-2.5 font-semibold">Job Card</th>
              <th className="px-5 py-2.5 font-semibold">Style</th>
              {/* Change 22 Part E: a hand adjustment records WHY it moved stock. */}
              <th className="px-5 py-2.5 font-semibold">Reason / note</th>
              <th className="px-5 py-2.5 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((m) => (
              <tr key={m.id} className="border-b border-hairline last:border-0">
                <td className="px-5 py-2.5 text-t2 tnum">{fmtDate(m.date)}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={m.type === "ISSUE" ? "danger" : "ok"}>{m.type}</Badge>
                </td>
                <td className="px-5 py-2.5 font-medium text-t2">{m.color ?? "—"}</td>
                <td className="px-5 py-2.5">
                  {m.jobCard ? (
                    <Link href={`/job-cards/${m.jobCard.id}`} className="font-semibold text-primary-ink hover:underline">
                      {m.jobCard.siNo}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-2.5 text-t2">{m.jobCard ? jobItem(m.jobCard) : "—"}</td>
                <td className="px-5 py-2.5 text-t2">
                  {m.reason ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={m.reason === "DAMAGE" || m.reason === "WASTAGE" ? "warn" : "default"}>{m.reason}</Badge>
                      {m.note && <span className="t-xs text-faint">{m.note}</span>}
                    </span>
                  ) : (
                    <span className="text-faint">{m.note ?? "—"}</span>
                  )}
                </td>
                <td className={`px-5 py-2.5 text-right font-bold tnum ${m.type === "ISSUE" ? "text-danger" : "text-ok"}`}>
                  {m.type === "ISSUE" ? "−" : "+"}
                  {num(m.qty)}
                </td>
              </tr>
            ))}
            {ledger.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-muted">No movements</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
