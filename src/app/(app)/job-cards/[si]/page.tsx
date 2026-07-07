import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob, getJobMatrix } from "@/lib/jobs";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { colorKey } from "@/lib/colour";
import { Card, Badge } from "@/components/ui";
import { FabricActualsForm } from "@/components/fabric-actuals-form";
import { TrimSheet } from "@/components/trim-sheet";
import { StatusTimeline } from "@/components/status-timeline";
import { JobStitching, type StitchAssignmentView } from "@/components/job-stitching";
import { LayerDispatch, type DispatchLayer } from "@/components/layer-dispatch";
import { AddCuttingLayer } from "@/components/add-cutting-layer";
import { num, inr, fmtDate, pct } from "@/lib/format";
import { STAGE_LABEL, stageTone, normStage } from "@/lib/job-labels";
import { jobItem, jobStyle, jobMrp } from "@/lib/job-display";
import { JobStageSelect } from "@/components/job-stage-select";
import { JobQualityCard } from "@/components/job-quality-card";
import { ArrowLeft, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const orderSizes = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
};

export default async function JobDetail({ params }: { params: Promise<{ si: string }> }) {
  const { si } = await params;
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const j = await getJob(si, scope);
  if (!j) notFound();

  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";
  const canSeeCost = u?.role === "ADMIN";
  const [vendorList, masterList] = canEdit
    ? await Promise.all([
        db.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.cuttingMaster.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
      ])
    : [[], []];

  const balance = j.cutQty - j.dispatchedQty;
  const fill = j.cutQty ? j.dispatchedQty / j.cutQty : 0;
  const overdue = j.status === "ACTIVE" && j.plannedEtd && j.plannedEtd < new Date() && balance > 0;
  const stage = normStage(j.stage);
  const unit = j.product?.unit ?? "MTR";

  // canonical cut matrix (layers when present, else legacy SizeBreakup)
  const mx = getJobMatrix(j);
  const hasColor = mx.colours.some((c) => c !== "" && c !== "—");

  const returned = j.returnNotes.reduce((a, r) => a + r.qty, 0);
  const itemDesc = jobItem(j);
  const styleNo = jobStyle(j);

  // per-colour fabric
  const returnedByColour = new Map<string, number>();
  for (const r of j.returnNotes)
    returnedByColour.set(colorKey(r.color), (returnedByColour.get(colorKey(r.color)) ?? 0) + r.qty);
  const hasFabricLines = j.fabricLines.length > 0;
  const fabricGsm = j.product?.fabric?.gsm ?? null;
  const fabricWidth = j.product?.fabric?.rollWidth ?? null;
  const hasFabricDetail = j.fabricLines.some((l) => l.reqPcs != null || l.reqMtr != null || l.rolls != null || l.imageUrl != null);
  const actualsLines = hasFabricLines
    ? j.fabricLines.map((l) => ({
        color: l.color,
        estAvg: l.estAvg,
        actualAvg: l.actualAvg,
        gsm: l.gsm,
        rollWidth: l.rollWidth,
        qtyIssued: l.qtyIssued ?? 0,
        qtyUsed: l.qtyUsed ?? l.qtyIssued ?? 0,
        returned: returnedByColour.get(colorKey(l.color)) ?? 0,
        locked: returnedByColour.has(colorKey(l.color)),
      }))
    : [
        {
          color: "",
          estAvg: j.estAvg,
          actualAvg: j.actualAvg,
          gsm: null,
          rollWidth: null,
          qtyIssued: j.fabricDispatched ?? j.estFabric ?? 0,
          qtyUsed: j.fabricUsed ?? 0,
          returned,
          locked: j.returnNotes.length > 0,
        },
      ];

  // stitching assignments → per-vendor balance (Part G)
  const stitch: StitchAssignmentView[] = j.stitchAssignments.map((a) => {
    const received = a.receipts.reduce((x, r) => x + r.qty, 0);
    return {
      id: a.id,
      vendorName: a.vendor.name,
      colour: a.colour,
      lotQty: a.lotQty,
      note: a.note,
      received,
      balance: a.lotQty != null ? a.lotQty - received : null,
      receipts: a.receipts.map((r) => ({ id: r.id, date: r.date.toISOString(), qty: r.qty, note: r.note })),
    };
  });

  // total fabric/roll roll-up across layers (Part C)
  const totalLayerMtr = j.layers.reduce((a, l) => a + (l.fabricMtr ?? 0), 0);
  const totalLayerRolls = j.layers.reduce((a, l) => a + (l.rolls ?? 0), 0);

  // Change 14: layers + prior dispatch for the multi-layer dispatch widget
  const dispatchLayers: DispatchLayer[] = j.layers.map((l) => ({
    id: l.id,
    layerNo: l.layerNo,
    label: l.label,
    vendor: l.vendor?.name ?? null,
    cells: l.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })),
  }));
  const priorDispatch = j.dispatches.map((e) => ({ id: e.id, qty: e.qty, layerIds: e.layers.map((x) => x.id) }));

  const meta = [
    ["Style No", styleNo],
    ["Item", itemDesc],
    ...(canSeeCost ? ([["MRP", inr(j.mrp ?? jobMrp(j))]] as const) : ([] as const)),
    ["Merchandiser", j.merchandiser ?? "—"],
    ["Vendor", j.vendor.name],
    ["Cutting Master", j.cuttingMaster?.name ?? "—"],
    ["Fabric", j.product?.fabric?.name ?? "—"],
    ["Avg Consumption", j.avgConsumption ? `${j.avgConsumption} ${unit.toLowerCase()}/pc` : "—"],
    ["Order Date", fmtDate(j.orderDate)],
    ["Planned ETD", fmtDate(j.plannedEtd)],
  ] as const;

  const flags = [
    ["PRINT", j.needsPrint],
    ["LASER", j.needsLaser],
    ["EMB", j.needsEmb],
  ] as const;

  return (
    <div className="p-6">
      <Link href="/job-cards" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Job Cards
      </Link>

      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold tracking-tight">{j.siNo}</h1>
            {overdue ? <Badge tone="danger">Overdue</Badge> : j.status === "CLOSED" ? <Badge tone="ok">Closed</Badge> : <Badge tone="primary">Active</Badge>}
            {canEdit ? (
              <JobStageSelect jobCardId={j.id} stage={stage} />
            ) : (
              <Badge tone={stageTone(stage)}>{STAGE_LABEL[stage]}</Badge>
            )}
            {!j.product && <Badge tone="warn">Made-to-order</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {itemDesc} · {styleNo}
            {j.product && (
              <Link href={`/catalog/${encodeURIComponent(j.product.skuCode)}`} className="ml-2 text-primary-ink hover:underline">view product →</Link>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Link href={`/job-cards/new?si=${encodeURIComponent(j.siNo)}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-3.5 py-2 text-[13px] font-semibold text-primary-ink hover:bg-slate-50">
              <Plus size={14} /> Add split / re-cut
            </Link>
          )}
          <Link href={`/challan/${j.id}`} className="rounded-lg border border-border px-3.5 py-2 text-[13px] font-semibold text-primary-ink hover:bg-slate-50">
            Share challan
          </Link>
        </div>
      </div>

      {/* process flags */}
      <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
        {flags.map(([label, on]) => (
          <span key={label} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? "border-primary bg-primary text-white" : "border-border bg-white text-slate-400 line-through decoration-slate-300"}`}>
            {label}
          </span>
        ))}
      </div>

      {/* top stats */}
      <div className="grid grid-cols-4 gap-3.5">
        {[
          ["Cut Qty", num(j.cutQty)],
          ["Received", num(j.dispatchedQty)],
          ["Balance", num(balance)],
          ["Fill Rate", pct(fill, 1)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className={`mt-1.5 text-[22px] font-extrabold tnum ${l === "Balance" && balance < 0 ? "text-rose-600" : ""}`}>{v}</div>
          </Card>
        ))}
      </div>

      {j.remark && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">📝 {j.remark}</div>
      )}

      <StatusTimeline
        steps={[
          { label: "Fabric", date: j.fabricIssueDate, done: stage !== "FABRIC_AWAITED" || j.fabricLines.some((l) => (l.qtyIssued ?? 0) > 0) || !!j.fabricIssueDate },
          { label: "Cut", date: j.cuttingIssuedOn ?? j.orderDate, done: !!j.cuttingIssuedOn || j.cutQty > 0 },
          { label: "On machine", date: null, done: stage === "ON_MACHINE" || stage === "FINISHING" || stage === "DISPATCH" || j.dispatchedQty > 0 },
          { label: "Finishing", date: null, done: stage === "FINISHING" || stage === "DISPATCH" || j.dispatchedQty > 0 },
          { label: "Received", date: j.dispatches[0]?.date ?? null, done: j.dispatchedQty > 0 },
          { label: "Closed", date: j.dispatches[j.dispatches.length - 1]?.date ?? null, done: j.status === "CLOSED" },
        ]}
      />

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {/* details */}
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-bold">Order Details</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12px]">
            {meta.map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="text-[11px] text-faint">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* dispatch log with reason + running balance */}
        <Card className="p-5">
          <h3 className="mb-3 text-[13px] font-bold">
            Dispatch Log <span className="font-medium text-faint">· {j.dispatches.length} events</span>
          </h3>
          {j.dispatches.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-muted">No dispatch yet.</p>
          ) : (
            <div className="space-y-1.5">
              {j.dispatches.map((e) => {
                const layerLabels = e.layers.map((x) => x.label || `L${x.layerNo}`);
                const cells = e.lines.map((ln) => `${ln.colour ? ln.colour + " " : ""}${ln.size}:${num(ln.qty)}`);
                return (
                  <div key={e.id} className="border-b border-slate-50 py-2 text-[12px] last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="flex flex-wrap items-center gap-2 text-slate-500 tnum">
                        {fmtDate(e.date)}
                        <Badge tone={e.reason === "SALE" ? "warn" : e.reason === "OTHER" ? "default" : "primary"}>{e.reason}</Badge>
                        {layerLabels.length > 0 && <span className="text-faint">{layerLabels.join(" + ")}</span>}
                        {e.challan && <span className="text-faint">challan {e.challan}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-bold tnum">+{num(e.qty)}</span>
                        <Link href={`/dispatch-doc/${e.id}`} className="text-[11px] font-semibold text-primary-ink hover:underline no-print">doc →</Link>
                      </span>
                    </div>
                    {cells.length > 0 && <div className="mt-0.5 text-[11px] text-faint">{cells.join(" · ")}</div>}
                  </div>
                );
              })}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[12px]">
                <span className="font-semibold">Balance (cut − dispatched)</span>
                <span className={`font-extrabold tnum ${balance < 0 ? "text-rose-600" : balance === 0 ? "text-emerald-600" : ""}`}>{num(balance)}</span>
              </div>
            </div>
          )}
          {canEdit && <LayerDispatch jobCardId={j.id} layers={dispatchLayers} prior={priorDispatch} defaultArrangedBy={u?.displayName ?? ""} />}
        </Card>
      </div>

      {/* cutting layers */}
      {j.layers.length > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">
            Cutting Layers <span className="font-medium text-faint">· {j.layers.length} lay{j.layers.length > 1 ? "s" : ""}
              {totalLayerMtr > 0 && ` · ${num(totalLayerMtr)} ${unit.toLowerCase()}`}{totalLayerRolls > 0 && ` · ${num(totalLayerRolls)} rolls`}</span>
          </h3>
          <div className="space-y-3">
            {j.layers.map((l) => {
              const lsizes = [...new Set(l.cells.map((c) => c.size))].sort(orderSizes);
              const lcolours = [...new Set(l.cells.map((c) => c.colour))].sort();
              const lcell = (s: string, c: string) => l.cells.find((x) => x.size === s && x.colour === c)?.qty ?? 0;
              const ltotal = l.cells.reduce((a, c) => a + c.qty, 0);
              const note = [
                l.avgConsumption != null ? `avg ${num(l.avgConsumption, 3)}` : null,
                l.rolls != null ? `${num(l.rolls)} roll` : null,
                l.fabricMtr != null ? `${num(l.fabricMtr)} mtr` : null,
                l.fabricBalance != null ? `bal ${num(l.fabricBalance)}` : null,
              ].filter(Boolean).join(" · ");
              return (
                <div key={l.id} className="rounded-xl border border-border p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <span className="flex items-center gap-1.5 font-bold text-primary-ink">{l.label || `Layer ${l.layerNo}`} <span className="font-medium text-faint">· {num(ltotal)} pcs</span>{l.vendor && <Badge tone="primary">{l.vendor.name}</Badge>}</span>
                    <span className="text-faint">{l.cutDate ? fmtDate(l.cutDate) : ""}{l.cuttingMaster ? ` · ${l.cuttingMaster.name}` : ""}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-center text-[12px]">
                      <thead>
                        <tr className="text-[10px] font-bold text-faint">
                          <th className="px-2 py-1 text-left">Colour \ Size</th>
                          {lsizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
                          <th className="px-2 py-1 text-primary-ink">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lcolours.map((c) => (
                          <tr key={c || "—"} className="border-t border-slate-50">
                            <td className="px-2 py-1 text-left font-semibold text-slate-600">{c || "—"}</td>
                            {lsizes.map((s) => <td key={s} className="px-2 py-1 tnum">{lcell(s, c) || ""}</td>)}
                            <td className="px-2 py-1 font-bold text-primary-ink tnum">{num(lsizes.reduce((a, s) => a + lcell(s, c), 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {note && <p className="mt-1.5 text-[11px] text-muted">{note}</p>}
                </div>
              );
            })}
          </div>
          {canEdit && (
            <AddCuttingLayer
              jobCardId={j.id}
              sizes={mx.sizes.length ? mx.sizes : SIZE_ORDER.slice(0, 6)}
              colours={mx.colours.filter((c) => c !== "" && c !== "—")}
              masters={masterList.map((m) => m.name)}
            />
          )}
        </Card>
      )}

      {/* estimate vs actual fabric — per colour */}
      <div id="fabric" />
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 text-[13px] font-bold">
          Fabric · Estimate vs Actual{" "}
          {hasFabricLines && <span className="font-medium text-faint">· per colour ({unit.toLowerCase()})</span>}
        </h3>
        {hasFabricLines ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">Colour</th>
                  {hasFabricDetail && <th className="px-2 py-2 text-right font-semibold">Req pcs</th>}
                  {hasFabricDetail && <th className="px-2 py-2 text-right font-semibold">Req mtr</th>}
                  {hasFabricDetail && <th className="px-2 py-2 text-right font-semibold">Rolls</th>}
                  <th className="px-2 py-2 text-right font-semibold">Assumed avg</th>
                  <th className="px-2 py-2 text-right font-semibold">Actual avg</th>
                  <th className="px-2 py-2 text-right font-semibold">GSM</th>
                  <th className="px-2 py-2 text-right font-semibold">Width</th>
                  <th className="px-2 py-2 text-right font-semibold">Issued</th>
                  <th className="px-2 py-2 text-right font-semibold">Used</th>
                  <th className="px-2 py-2 text-right font-semibold">Returned</th>
                </tr>
              </thead>
              <tbody>
                {j.fabricLines.map((l) => {
                  const ret = returnedByColour.get(colorKey(l.color)) ?? 0;
                  return (
                    <tr key={l.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-1.5 font-semibold text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          {l.imageUrl && <img src={l.imageUrl} alt="" className="h-6 w-6 rounded object-cover" />}
                          {l.color || "—"}
                        </span>
                      </td>
                      {hasFabricDetail && <td className="px-2 py-1.5 text-right tnum text-slate-500">{l.reqPcs != null ? num(l.reqPcs) : "—"}</td>}
                      {hasFabricDetail && <td className="px-2 py-1.5 text-right tnum text-slate-500">{l.reqMtr != null ? num(l.reqMtr) : "—"}</td>}
                      {hasFabricDetail && <td className="px-2 py-1.5 text-right tnum text-slate-500">{l.rolls != null ? num(l.rolls) : "—"}</td>}
                      <td className="px-2 py-1.5 text-right tnum">{l.estAvg != null ? num(l.estAvg, 3) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.actualAvg != null ? num(l.actualAvg, 3) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-slate-500">{l.gsm ?? fabricGsm ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-slate-500">{l.rollWidth ?? fabricWidth ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right font-bold tnum">{l.qtyIssued != null ? num(l.qtyIssued) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.qtyUsed != null ? num(l.qtyUsed) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-emerald-600">{ret > 0 ? num(ret) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3.5 text-[12px]">
            {[
              ["Est avg", j.estAvg != null ? `${j.estAvg} ${unit.toLowerCase()}/pc` : "—"],
              ["Est fabric", j.estFabric != null ? `${num(j.estFabric)} ${unit.toLowerCase()}` : "—"],
              ["Actual avg", j.actualAvg != null ? `${j.actualAvg} ${unit.toLowerCase()}/pc` : "—"],
              ["Dispatched", j.fabricDispatched != null ? `${num(j.fabricDispatched)} ${unit.toLowerCase()}` : "—"],
              ["Used", j.fabricUsed != null ? `${num(j.fabricUsed)} ${unit.toLowerCase()}` : "—"],
              ["Returned", returned > 0 ? `${num(returned)} ${unit.toLowerCase()}` : "—"],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-[11px] text-faint">{l}</div>
                <div className="mt-0.5 font-semibold tnum">{v}</div>
              </div>
            ))}
          </div>
        )}
        {u?.role !== "VENDOR" && j.product?.fabricId != null && (
          <FabricActualsForm jobCardId={j.id} unit={unit} lines={actualsLines} defaultArrangedBy={u?.displayName ?? ""} />
        )}
      </Card>

      {/* quality / quantity capture (Change 12, Part G) — reject · alter · extra */}
      {(canEdit || j.rejectQty != null || j.alterQty != null || j.extraQty != null) && (
        <JobQualityCard
          jobCardId={j.id}
          canEdit={canEdit}
          rejectQty={j.rejectQty}
          alterQty={j.alterQty}
          extraQty={j.extraQty}
        />
      )}

      {/* stitching — multi-vendor (Part G) */}
      {(stitch.length > 0 || canEdit) && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">Stitching Vendors <span className="font-medium text-faint">· lot · received · balance</span></h3>
          <JobStitching jobCardId={j.id} canEdit={canEdit} vendors={vendorList} assignments={stitch} />
        </Card>
      )}

      {/* size×color grand roll-up (across layers) */}
      {mx.total > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 text-[13px] font-bold">Size {hasColor ? "× Colour" : ""} Breakup <span className="font-medium text-faint">· grand total</span></h3>
          {hasColor ? (
            <div className="overflow-x-auto">
              <table className="w-full text-center text-[12px]">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-faint">
                    <th className="px-2 py-1.5 text-left">Colour</th>
                    {mx.sizes.map((s) => <th key={s} className="px-2 py-1.5">{s}</th>)}
                    <th className="px-2 py-1.5 text-primary-ink">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mx.colours.map((c) => (
                    <tr key={c} className="border-t border-slate-50">
                      <td className="px-2 py-1.5 text-left font-semibold text-slate-600">{c === "" ? "—" : c}</td>
                      {mx.sizes.map((s) => <td key={s} className="px-2 py-1.5 tnum">{mx.cell(c, s) || ""}</td>)}
                      <td className="px-2 py-1.5 font-bold text-primary-ink tnum">{num(mx.byColour.find((b) => b.colour === c)?.qty ?? 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border">
                    <td className="px-2 py-1.5 text-left text-[10px] font-bold text-primary-ink">Total</td>
                    {mx.sizes.map((s) => <td key={s} className="px-2 py-1.5 font-bold tnum">{num(mx.bySize.find((b) => b.size === s)?.qty ?? 0)}</td>)}
                    <td className="px-2 py-1.5 font-extrabold text-primary-ink tnum">{num(mx.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${mx.sizes.length + 1}, minmax(0, 1fr))` }}>
              {mx.sizes.map((s) => (
                <div key={s}>
                  <div className="text-[11px] font-bold text-faint">{s}</div>
                  <div className="mt-1 rounded-lg border border-border bg-slate-50 py-2.5 text-[14px] font-bold tnum">{num(mx.bySize.find((b) => b.size === s)?.qty ?? 0)}</div>
                </div>
              ))}
              <div>
                <div className="text-[11px] font-bold text-primary-ink">Total</div>
                <div className="mt-1 rounded-lg bg-primary-soft py-2.5 text-[14px] font-bold text-primary-ink tnum">{num(mx.total)}</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Trim sheet (editable issue log) */}
      <div id="trims" />
      {j.jobLines.length > 0 && (
        <TrimSheet
          canEdit={canEdit}
          defaultArrangedBy={u?.displayName ?? ""}
          lines={j.jobLines.map((l) => ({
            id: l.id,
            material: l.material,
            color: l.color,
            dimension: l.dimension ?? "FLAT",
            requiredQty: l.requiredQty ?? l.totalQty ?? null,
            issuedQty: l.issuedQty ?? null,
            arrangedBy: l.arrangedBy ?? null,
            issueDate: l.issueDate ? l.issueDate.toISOString() : null,
            challan: l.challan ?? null,
            trimName: l.trimItem?.name ?? null,
            trimCurrent: l.trimItem ? l.trimItem.currentStock : null,
          }))}
        />
      )}
    </div>
  );
}
