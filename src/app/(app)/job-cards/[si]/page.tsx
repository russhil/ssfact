import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob, getJobMatrix, getJobTrimIssues, getJobFabricPosted, getJobFabricStock, getJobFabricStockElsewhere } from "@/lib/jobs";
import { getJobCardChallans } from "@/lib/masters";
import { getJobQuality, getJobInspections, getJobReworks, getDefectTypes } from "@/lib/quality";
import { getJobYield } from "@/lib/yield";
import { getJobMargins } from "@/lib/insights";
import { db } from "@/lib/db";
import { getCurrentUser, canSeeCost as canSee } from "@/lib/auth";
import { colorKey } from "@/lib/colour";
import { Card, Badge } from "@/components/ui";
import { FabricActualsForm } from "@/components/fabric-actuals-form";
import { TrimSheet } from "@/components/trim-sheet";
import { StatusTimeline } from "@/components/status-timeline";
import { LayerDispatch, type DispatchLayer } from "@/components/layer-dispatch";
import { AddCuttingLayer } from "@/components/add-cutting-layer";
import { CuttingChallanButton } from "@/components/cutting-challan-button";
import { UnlockJobButton } from "@/components/unlock-job-button";
import { DispatchActions } from "@/components/dispatch-actions";
import { JobCardActions } from "@/components/job-card-actions";
import { LayerActions } from "@/components/layer-actions";
import { LayerFabricTable } from "@/components/job-card/layer-grid";
import { FinishingPanel } from "@/components/finishing-panel";
import { PressPanel } from "@/components/press-panel";
import { getJobPress } from "@/lib/press";
import { JobTrimChallanButton } from "@/components/job-trim-challan-button";
import { num, inr, fmtDate, pct } from "@/lib/format";
import { STAGE_LABEL, stageTone, normStage, SIZE_ORDER, orderSizes } from "@/lib/job-labels";
import { jobItem, jobStyle, jobMrp } from "@/lib/job-display";
import { JobStageSelect } from "@/components/job-stage-select";
import { JobQualityCard } from "@/components/job-quality-card";
import { InspectionPanel } from "@/components/inspection-panel";
import { ArrowLeft, Plus } from "lucide-react";

export const dynamic = "force-dynamic";


export default async function JobDetail({ params }: { params: Promise<{ si: string }> }) {
  const { si } = await params;
  const u = await getCurrentUser();
  const scope = u?.role === "VENDOR" ? { vendorName: u.vendor ?? "" } : undefined;
  const j = await getJob(si, scope);
  // Change 38 Part E — read the shared per-colour stock fresh on every load, so a card
  // saved elsewhere shows up here.
  const fabricStock = j ? await getJobFabricStock(j.id) : new Map<string, number>();
  // Change 40 L7 — the same fabric-colours at OTHER firms, shown as a non-consumable hint.
  const fabricElsewhere = j ? await getJobFabricStockElsewhere(j.id) : new Map<string, { firm: string; qty: number }[]>();
  if (!j) notFound();

  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";
  const canSeeCost = canSee(u);
  const masterList = canEdit
    ? await db.cuttingMaster.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } })
    : [];
  // Change 40 Part K — this card's in-house pressing documents + selectable layers.
  const jobPress = canEdit ? await getJobPress(j.id) : null;
  // Change 20: this card's finishing job-work (optional — a card may have none).
  const finishingJobs = await db.finishingJob.findMany({
    where: { jobCardId: j.id },
    include: { vendor: { select: { name: true } }, layers: { select: { layerNo: true, label: true } } },
    orderBy: { id: "asc" },
  });

  // Change 22 Part D: the layer editor lets a lay be re-pointed at a different vendor.
  const vendorNames = canEdit
    ? (await db.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } })).map((v) => v.name)
    : [];
  // Change 17 Part C: challans raised against this job card (by kind).
  const jobChallans = canEdit ? await getJobCardChallans(j.id) : [];
  // Change 19 A.4: trims actually issued = locked OUTWARD challan lines (drafts = pending).
  const trimIssues = await getJobTrimIssues(j.id);
  // Change 36 Part 3: the card's inspection position, so dispatch can warn (never block).
  const jobQuality = await getJobQuality(j.id);
  // Change 36 Part 5 — owner-only, and not even queried otherwise.
  const jobYield = canSeeCost ? await getJobYield(j.id) : null;
  const [jobInspections, jobReworks, defectTypes] = canEdit
    ? await Promise.all([getJobInspections(j.id), getJobReworks(j.id), getDefectTypes()])
    : [[], [], []];
  // Change 19 B: net fabric already posted per colour, so the actuals form can preview the
  // real movement (deduct / return / nothing) instead of the old clamped "return" figure.
  const fabricPosted = j.product?.fabricId != null ? await getJobFabricPosted(j.id, j.product.fabricId) : new Map<string, number>();

  const balance = j.cutQty - j.dispatchedQty;
  const fill = j.cutQty ? j.dispatchedQty / j.cutQty : 0;
  // Change 39 Part F — a finalised card with issued material is frozen. Editing existing
  // layers is blocked; issuing more material / images / progress stay open. Admins can unlock.
  const locked = !!j.editLockedAt;
  const isAdmin = u?.role === "ADMIN";
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
        // Change 19 B: colours are no longer locked after the first return — the server
        // reconciles to USED and is idempotent, so actuals stay editable forever.
        posted: fabricPosted.get(colorKey(l.color)) ?? 0,
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
          posted: fabricPosted.get("") ?? 0,
        },
      ];

  // Change 16 Part F: legacy card-level stitch assignments, READ-ONLY (retired panel).
  // Vendor now lives on the layer + received = dispatch. Render only if history exists.
  const legacyStitch = j.stitchAssignments.map((a) => {
    const received = a.receipts.reduce((x, r) => x + r.qty, 0);
    return {
      id: a.id,
      vendorName: a.vendor.name,
      colour: a.colour,
      lotQty: a.lotQty,
      received,
      balance: a.lotQty != null ? a.lotQty - received : null,
    };
  });

  // total fabric/roll roll-up across layers (Part C)
  const totalLayerMtr = j.layers.reduce((a, l) => a + (l.fabricMtr ?? 0), 0);
  const totalLayerRolls = j.layers.reduce((a, l) => a + (l.rolls ?? 0), 0);
  // Change 19 C: card-level Issued/Extra to match the per-layer strip. Extra is null when
  // no layer records an issued figure (legacy rows) — an unknown, not a zero.
  const totalLayerIssued = j.layers.reduce((a, l) => a + (l.fabricIssued ?? 0), 0);
  const totalLayerExtra = j.layers.some((l) => l.fabricIssued != null)
    ? Math.round((totalLayerIssued - totalLayerMtr) * 100) / 100
    : null;
  // The vendors actually stitching this card live on its layers, not the header.
  const layerVendors = [...new Set(j.layers.map((l) => l.vendor?.name).filter((n): n is string => !!n))];

  // Change 14: layers + prior dispatch for the multi-layer dispatch widget
  const dispatchLayers: DispatchLayer[] = j.layers.map((l) => ({
    id: l.id,
    layerNo: l.layerNo,
    label: l.label,
    vendor: l.vendor?.name ?? null,
    cells: l.cells.map((c) => ({ colour: c.colour, size: c.size, qty: c.qty })),
  }));
  // Change 22 B.1: voided events are shown in the log but must never feed a balance.
  const liveDispatches = j.dispatches.filter((e) => !e.voidedAt);
  const voidedCount = j.dispatches.length - liveDispatches.length;
  const priorDispatch = liveDispatches.map((e) => ({ id: e.id, qty: e.qty, layerIds: e.layers.map((x) => x.id) }));

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

  // Change 25 Part F — cost / value / margin for this card. Owner-only: not queried
  // at all otherwise, so no cost figure reaches a staff session.
  const margin = canSeeCost ? (await getJobMargins({ jobCardId: j.id }))[0] ?? null : null;

  /**
   * Change 38 Part E — this card's fabric usage by colour AND by layer, against the real
   * shared stock left for that colour.
   *
   * The usage cells are the DERIVED used (issued − balance, Part B) taken straight off each
   * lay's colour rows. The stock column is the shared FabricColor.currentStock, which every
   * other card draws from too — so saving a card that eats NAVY moves the figure shown here.
   */
  const summaryFabricId = j.product?.fabricId ?? j.fabricLines[0]?.fabricId ?? null;
  const summaryColours = [
    ...new Set(j.layers.flatMap((l) => (l.colours ?? []).map((c) => c.colour))),
  ].sort();
  const layerUsedFor = (layer: (typeof j.layers)[number], colour: string) => {
    const row = (layer.colours ?? []).find((c) => c.colour === colour);
    return row?.fabricUsed ?? null;
  };

  return (
    <div className="p-6">
      <Link href="/job-cards" className="mb-4 inline-flex items-center gap-1.5 t-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Job Cards
      </Link>

      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="t-display font-bold tracking-tight">{j.siNo}</h1>
            {overdue ? <Badge tone="danger">Overdue</Badge> : j.status === "CLOSED" ? <Badge tone="ok">Closed</Badge> : <Badge tone="primary">Active</Badge>}
            {canEdit ? (
              <JobStageSelect jobCardId={j.id} stage={stage} />
            ) : (
              <Badge tone={stageTone(stage)}>{STAGE_LABEL[stage]}</Badge>
            )}
            {!j.product && <Badge tone="warn">Made-to-order</Badge>}
            {/* Change 40 Part L2 — the firm this card belongs to (consumes only its stock). */}
            {j.buyer?.name && <Badge tone="default">{j.buyer.name}</Badge>}
            {/* Change 39 Part F — frozen once material has issued against the card. */}
            {locked && <Badge tone="warn">Locked — material issued</Badge>}
          </div>
          <p className="mt-0.5 t-body text-muted">
            {itemDesc} · {styleNo}
            {j.product && (
              <Link href={`/catalog/${encodeURIComponent(j.product.skuCode)}`} className="ml-2 text-primary-ink hover:underline">view product →</Link>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Change 22 Part C: reopen/close, edit header details, delete a mistaken card. */}
          {canEdit && (
            <JobCardActions
              canSeeCost={canSeeCost}
              job={{
                id: j.id, siNo: j.siNo, status: j.status, hasProduct: !!j.productId,
                plannedEtd: j.plannedEtd ? j.plannedEtd.toISOString().slice(0, 10) : null,
                merchandiser: j.merchandiser, remark: j.remark,
                needsPrint: j.needsPrint, needsLaser: j.needsLaser, needsEmb: j.needsEmb,
                customItem: j.customItem, customSku: j.customSku, customStyle: j.customStyle,
                mrp: j.mrp, customMrp: j.customMrp,
                liveDispatches: liveDispatches.length,
                lockedChallans: jobChallans.filter((c) => c.status === "LOCKED").length,
              }}
            />
          )}
          {canEdit && (
            <Link href={`/job-cards/new?si=${encodeURIComponent(j.siNo)}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-3.5 py-2 t-body font-semibold text-primary-ink hover:bg-surface-2">
              <Plus size={14} /> Add split / re-cut
            </Link>
          )}
          {/* Change 39 Part F — ADMIN unlock for correction (audited). */}
          {locked && isAdmin && <UnlockJobButton jobCardId={j.id} />}
          <Link href={`/challan/${j.id}`} className="rounded-lg border border-border px-3.5 py-2 t-body font-semibold text-primary-ink hover:bg-surface-2">
            Share challan
          </Link>
        </div>
      </div>

      {/* Change 39 Part G — authorised signatory (firm contact name; firm-name fallback, never
          the login user) + who prepared the card. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 t-xs text-muted">
        <span>Authorised signatory: <b className="text-t1">{j.signatoryName ?? "Sport Sun"}</b></span>
        {j.createdBy?.displayName && (
          <span>Prepared by <b className="text-t1">{j.createdBy.displayName}</b>{j.createdAt ? ` · ${fmtDate(j.createdAt)}` : ""}</span>
        )}
      </div>

      {/* process flags */}
      <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
        {flags.map(([label, on]) => (
          <span key={label} className={`rounded-full border px-2.5 py-1 t-xs font-bold ${on ? "border-primary bg-primary text-accent-on" : "border-border bg-surface text-t3 line-through decoration-t3"}`}>
            {label}
          </span>
        ))}
      </div>

      {/* top stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
        {[
          ["Cut Qty", num(j.cutQty)],
          ["Received", num(j.dispatchedQty)],
          ["Balance", num(balance)],
          ["Fill Rate", pct(fill, 1)],
        ].map(([l, v]) => (
          <Card key={l} className="p-4">
            <div className="t-xs font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className={`mt-1.5 t-display font-extrabold tnum ${l === "Balance" && balance < 0 ? "text-danger" : ""}`}>{v}</div>
          </Card>
        ))}
      </div>

      {j.remark && (
        <div className="mt-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 t-sm text-warn">{j.remark}</div>
      )}

      <StatusTimeline
        steps={[
          { label: "Fabric", date: j.fabricIssueDate, done: stage !== "FABRIC_AWAITED" || j.fabricLines.some((l) => (l.qtyIssued ?? 0) > 0) || !!j.fabricIssueDate },
          { label: "Cut", date: j.cuttingIssuedOn ?? j.orderDate, done: !!j.cuttingIssuedOn || j.cutQty > 0 },
          { label: "On machine", date: null, done: stage === "ON_MACHINE" || stage === "FINISHING" || stage === "DISPATCH" || j.dispatchedQty > 0 },
          { label: "Finishing", date: null, done: stage === "FINISHING" || stage === "DISPATCH" || j.dispatchedQty > 0 },
          { label: "Received", date: liveDispatches[0]?.date ?? null, done: j.dispatchedQty > 0 },
          { label: "Closed", date: liveDispatches[liveDispatches.length - 1]?.date ?? null, done: j.status === "CLOSED" },
        ]}
      />

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {/* details */}
        <Card className="p-5">
          <h3 className="mb-3 t-body font-bold">Order Details</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 t-sm">
            {meta.map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="t-xs text-faint">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {/* Change 25 Part F — evidenced cost vs dispatched value. Cost counts only
              locked, non-voided inward challan lines that carry a rate, plus finishing
              job-work: what we can actually show a bill for. */}
          {margin && (
            <div className="mt-4 border-t border-hairline pt-3">
              <div className="mb-2 t-xs font-semibold uppercase tracking-wide text-faint">Cost &amp; margin</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 t-sm">
                <div className="flex flex-col">
                  <dt className="t-xs text-faint">Fabric</dt>
                  <dd className="font-semibold tnum">{inr(margin.fabricCost)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="t-xs text-faint">Trims</dt>
                  <dd className="font-semibold tnum">{inr(margin.trimCost)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="t-xs text-faint">Finishing</dt>
                  <dd className="font-semibold tnum">{inr(margin.finishingCost)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="t-xs text-faint">Total cost</dt>
                  <dd className="font-semibold tnum">{inr(margin.cost)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="t-xs text-faint">Dispatched value</dt>
                  <dd className="font-semibold tnum">{margin.value > 0 ? inr(margin.value) : "—"}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="t-xs text-faint">Margin</dt>
                  <dd className="font-semibold tnum">
                    {margin.value <= 0 ? (
                      <span className="text-t3">—</span>
                    ) : margin.margin < 0 ? (
                      <span className="text-danger">{inr(margin.margin)}</span>
                    ) : (
                      <span className="text-ok">{inr(margin.margin)} <span className="font-medium text-t3">{pct(margin.marginPct)}</span></span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </Card>

        {/* dispatch log with reason + running balance */}
        <Card className="p-5">
          <h3 className="mb-3 t-body font-bold">
            Dispatch Log <span className="font-medium text-faint">· {liveDispatches.length} events{voidedCount > 0 && ` · ${voidedCount} void`}</span>
          </h3>
          {j.dispatches.length === 0 ? (
            <p className="py-4 text-center t-sm text-muted">No dispatch</p>
          ) : (
            <div className="space-y-1.5">
              {j.dispatches.map((e) => {
                const layerLabels = e.layers.map((x) => x.label || `L${x.layerNo}`);
                const cells = e.lines.map((ln) => `${ln.colour ? ln.colour + " " : ""}${ln.size}:${num(ln.qty)}`);
                // Change 22 B.1: a voided event keeps its DC number and stays visible as
                // history — dimmed and struck through, never counted.
                const dead = !!e.voidedAt;
                return (
                  <div key={e.id} className={`border-b border-hairline py-2 t-sm last:border-0 ${dead ? "opacity-55" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="flex flex-wrap items-center gap-2 text-t2 tnum">
                        {fmtDate(e.date)}
                        <Badge tone={e.reason === "SALE" ? "warn" : e.reason === "OTHER" ? "default" : "primary"}>{e.reason}</Badge>
                        {layerLabels.length > 0 && <span className="text-faint">{layerLabels.join(" + ")}</span>}
                        {e.challan && <span className="text-faint">challan {e.challan}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`font-bold tnum ${dead ? "line-through" : ""}`}>+{num(e.qty)}</span>
                        {canEdit && (
                          <DispatchActions
                            compact
                            event={{
                              id: e.id, dispatchNo: e.dispatchNo, date: e.date.toISOString(), qty: e.qty,
                              reason: e.reason, note: e.note, challan: e.challan, arrangedBy: e.arrangedBy,
                              voidedAt: e.voidedAt ? e.voidedAt.toISOString() : null,
                              lines: e.lines.map((ln) => ({ id: ln.id, colour: ln.colour, size: ln.size, qty: ln.qty })),
                            }}
                          />
                        )}
                        <Link href={`/dispatch-doc/${e.id}`} className="t-xs font-semibold text-primary-ink hover:underline no-print">doc →</Link>
                      </span>
                    </div>
                    {cells.length > 0 && <div className="mt-0.5 t-xs text-faint">{cells.join(" · ")}</div>}
                  </div>
                );
              })}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 t-sm">
                <span className="font-semibold">Balance (cut − dispatched)</span>
                <span className={`font-extrabold tnum ${balance < 0 ? "text-danger" : balance === 0 ? "text-ok" : ""}`}>{num(balance)}</span>
              </div>
            </div>
          )}
          {canEdit && <LayerDispatch jobCardId={j.id} layers={dispatchLayers} prior={priorDispatch} defaultArrangedBy={u?.displayName ?? ""} quality={{ status: jobQuality.status, openRework: jobQuality.openRework }} />}
        </Card>
      </div>

      {/* Cutting layers — Change 19 C: a numbered series under the header, each with its
          own vendor. The header vendor is the organiser; the layer vendor does the work. */}
      {(j.layers.length > 0 || canEdit) && (
        <Card className="mt-3.5 p-5">
          <h3 className="t-body font-bold">
            Cutting Layers <span className="font-medium text-faint">· {j.layers.length} lay{j.layers.length === 1 ? "" : "s"}
              {totalLayerMtr > 0 && ` · ${num(totalLayerMtr)} ${unit.toLowerCase()} used`}{totalLayerIssued > 0 && ` · ${num(totalLayerIssued)} issued`}{totalLayerRolls > 0 && ` · ${num(totalLayerRolls)} rolls`}</span>
          </h3>
          <p className="mb-3 mt-0.5 t-xs text-faint">
            Header vendor (organiser): <b className="text-t1">{j.vendor.name}</b>
            {layerVendors.length > 1 && <> · this card is split across {layerVendors.length} stitching vendors</>}
            {totalLayerExtra != null && <> · extra <b className={totalLayerExtra < 0 ? "text-danger" : "text-ok"}>{num(totalLayerExtra)}</b></>}
          </p>

          {/* Change 38 Part E — colour × layer usage, against the live shared stock. */}
          {/* phones: a card per colour (columns grow with layer count) */}
          {summaryColours.length > 0 && (
            <div className="mb-3 flex flex-col gap-2 md:hidden">
              {summaryColours.map((c) => {
                const per = j.layers.map((l) => layerUsedFor(l, c));
                const cardTotal = per.reduce((a: number, v) => a + (v ?? 0), 0);
                const left = summaryFabricId != null ? fabricStock.get(`${summaryFabricId}|${colorKey(c)}`) : undefined;
                return (
                  <div key={c || "—"} className="rounded-lg border border-hairline bg-surface p-3">
                    <div className="mb-2 t-sm font-bold text-t1">{c || "—"}</div>
                    {j.layers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {j.layers.map((l, i) => (
                          <span key={l.id} className="rounded bg-surface-2 px-1.5 py-0.5 t-micro font-semibold tnum text-t2">
                            Layer {l.layerNo}: {per[i] != null ? num(per[i]!, 2) : "—"}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 t-sm">
                      <span className="tnum text-t2">Used on card <b className="text-t1">{num(cardTotal, 2)}</b></span>
                      <span className={`tnum ${left != null && left < 0 ? "font-semibold text-danger" : "text-t2"}`}>
                        Stock left <b className={left != null && left < 0 ? "text-danger" : "text-t1"}>{left != null ? num(left, 2) : "—"}</b>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {summaryColours.length > 0 && (
            <div className="mb-3 hidden overflow-x-auto rounded-lg border border-hairline md:block">
              <table className="w-full t-sm">
                <thead>
                  <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                    <th className="px-2 py-2 font-semibold">Colour</th>
                    {j.layers.map((l) => (
                      <th key={l.id} className="px-2 py-2 text-right font-semibold">Layer {l.layerNo}</th>
                    ))}
                    <th className="border-l border-hairline px-2 py-2 text-right font-semibold">Used on this card</th>
                    <th className="px-2 py-2 text-right font-semibold">Stock left</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryColours.map((c) => {
                    const per = j.layers.map((l) => layerUsedFor(l, c));
                    const cardTotal = per.reduce((a: number, v) => a + (v ?? 0), 0);
                    const left = summaryFabricId != null ? fabricStock.get(`${summaryFabricId}|${colorKey(c)}`) : undefined;
                    const elsewhere = summaryFabricId != null ? fabricElsewhere.get(`${summaryFabricId}|${colorKey(c)}`) : undefined;
                    return (
                      <tr key={c || "—"} className="border-b border-hairline last:border-0">
                        <td className="px-2 py-1.5 font-semibold text-t1">{c || "—"}</td>
                        {per.map((v, i) => (
                          <td key={j.layers[i].id} className="px-2 py-1.5 text-right tnum text-t2">{v != null ? num(v, 2) : "—"}</td>
                        ))}
                        <td className="border-l border-hairline px-2 py-1.5 text-right font-bold tnum">{num(cardTotal, 2)}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold tnum ${left != null && left < 0 ? "text-danger" : "text-t1"}`}>
                          {left != null ? num(left, 2) : "—"}
                          {/* Change 40 L7 — other firms' stock is visible, NOT consumable. */}
                          {elsewhere && elsewhere.length > 0 && (
                            <div className="t-micro font-normal text-faint" title="Visible, not consumable — raise a transfer to use it">
                              {elsewhere.map((e) => `${num(e.qty, 0)} at ${e.firm}`).join(" · ")} ⓘ
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="border-t border-hairline px-2 py-1.5 t-micro text-faint">
                Stock left is the live figure shared with every other card using this fabric, and moves when any of them is saved.
              </p>
            </div>
          )}
          <div className="space-y-3">
            {j.layers.map((l) => {
              const lsizes = [...new Set(l.cells.map((c) => c.size))].sort(orderSizes);
              const lcolours = [...new Set(l.cells.map((c) => c.colour))].sort();
              const lcell = (s: string, c: string) => l.cells.find((x) => x.size === s && x.colour === c)?.qty ?? 0;
              const ltotal = l.cells.reduce((a, c) => a + c.qty, 0);
              // Change 39 B — measured avg = lay length ÷ pieces (the honest cousin of the
              // pre-cut estimate). Bundles are shown beside each colour's cut qty.
              const lLen = l.layerLength ?? null;
              const lAvgMeasured = lLen != null && ltotal > 0 ? lLen / ltotal : null;
              const lBundles = (c: string) => (l.colours ?? []).find((x) => x.colour === c)?.bundles ?? null;
              const anyBundles = (l.colours ?? []).some((c) => c.bundles != null);
              // Change 17 A: Issued · Used · Extra reconciliation (Extra = issued − used, may be negative).
              const lIssued = l.fabricIssued;
              const lUsed = l.fabricMtr;
              const lExtra = lIssued != null ? Math.round((lIssued - (lUsed ?? 0)) * 100) / 100 : null;
              const estNote = [
                l.avgConsumption != null ? `avg ${num(l.avgConsumption, 3)}` : null,
                l.rolls != null ? `${num(l.rolls)} roll` : null,
                l.fabricBalance != null ? `bal ${num(l.fabricBalance)}` : null,
              ].filter(Boolean).join(" · ");
              // Change 38 Part C — this lay's per-colour fabric, as the shared table expects it.
              const lColourRows = l.colours ?? [];
              const lFabricRows = Object.fromEntries(
                lColourRows.map((c) => [c.colour, {
                  issued: c.fabricIssued != null ? String(c.fabricIssued) : "",
                  balance: c.fabricBalance != null ? String(c.fabricBalance) : "",
                }])
              );
              return (
                <div key={l.id} className="rounded-xl border border-border p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 t-sm">
                    <span className="flex items-center gap-1.5 font-bold text-primary-ink">
                      Layer {l.layerNo}
                      {l.label && <span className="font-medium text-faint">{l.label}</span>}
                      <span className="font-medium text-faint">· {num(ltotal)} pcs</span>
                      {l.vendor && <Badge tone="primary">{l.vendor.name}</Badge>}
                    </span>
                    <span className="flex items-center gap-2 text-faint">
                      {l.cutDate ? fmtDate(l.cutDate) : ""}{l.cuttingMaster ? ` · ${l.cuttingMaster.name}` : ""}
                      {/* Change 39 Part D2 — issue this lay's cut goods as a cutting challan. */}
                      {canEdit && ltotal > 0 && <CuttingChallanButton jobCardId={j.id} layerId={l.id} />}
                      {/* Change 22 Part D: edit or remove this lay — frozen once the card locks (Change 39 F). */}
                      {canEdit && !locked && (
                        <LayerActions
                          unit={unit}
                          vendors={vendorNames}
                          masters={masterList.map((m) => m.name)}
                          layer={{
                            id: l.id, layerNo: l.layerNo, label: l.label,
                            cutDate: l.cutDate ? l.cutDate.toISOString().slice(0, 10) : null,
                            vendor: l.vendor?.name ?? null, cuttingMaster: l.cuttingMaster?.name ?? null,
                            rolls: l.rolls, fabricMtr: l.fabricMtr, fabricIssued: l.fabricIssued,
                            fabricBalance: l.fabricBalance, avgConsumption: l.avgConsumption,
                            // Change 37 — per-colour fabric, so the edit sheet can drive it
                            colours: (l.colours ?? []).map((c) => ({
                              colour: c.colour, fabricIssued: c.fabricIssued,
                              fabricBalance: c.fabricBalance, fabricUsed: c.fabricUsed,
                            })),
                            total: ltotal,
                            dispatched: liveDispatches
                              .filter((e) => e.layers.some((x) => x.id === l.id))
                              .reduce((a, e) => a + e.qty, 0),
                          }}
                        />
                      )}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-center t-sm">
                      <thead>
                        <tr className="t-micro font-bold text-faint">
                          <th className="px-2 py-1 text-left">Colour \ Size</th>
                          {lsizes.map((s) => <th key={s} className="px-2 py-1">{s}</th>)}
                          <th className="px-2 py-1 text-primary-ink">Total</th>
                          {anyBundles && <th className="px-2 py-1">Bundles</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lcolours.map((c) => (
                          <tr key={c || "—"} className="border-t border-hairline">
                            <td className="px-2 py-1 text-left font-semibold text-t1">{c || "—"}</td>
                            {lsizes.map((s) => <td key={s} className="px-2 py-1 tnum">{lcell(s, c) || ""}</td>)}
                            <td className="px-2 py-1 font-bold text-primary-ink tnum">{num(lsizes.reduce((a, s) => a + lcell(s, c), 0))}</td>
                            {anyBundles && <td className="px-2 py-1 tnum text-t2">{lBundles(c) != null ? num(lBundles(c)!) : "—"}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Change 38 Part C — the per-colour fabric captured at entry, shown back.
                      Change 37 recorded these figures and then never displayed them outside
                      the edit sheet. A legacy lay has no colour rows and keeps the old strip. */}
                  {lColourRows.length > 0 ? (
                    <div className="mt-2 border-t border-hairline pt-1.5">
                      <LayerFabricTable colours={lColourRows.map((c) => c.colour)} rows={lFabricRows} readOnly />
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 t-xs">
                        <span className="flex items-center gap-3">
                          <span className="text-muted">Issued <b className="tnum text-primary-ink">{lIssued != null ? num(lIssued) : "—"}</b></span>
                          <span className="text-muted">Balance <b className="tnum text-primary-ink">{l.fabricBalance != null ? num(l.fabricBalance) : "—"}</b></span>
                          <span className="text-muted">Used <b className="tnum text-primary-ink">{lUsed != null ? num(lUsed) : "—"}</b></span>
                        </span>
                        {lLen != null && <span className="text-faint">length {num(lLen, 1)} m</span>}
                        {/* Change 39 B — estimate vs measured avg side by side */}
                        {(l.avgConsumption != null || lAvgMeasured != null) && (
                          <span className="text-faint">
                            avg{l.avgConsumption != null ? ` est ${num(l.avgConsumption, 3)}` : ""}{lAvgMeasured != null ? ` · actual ${num(lAvgMeasured, 3)}` : ""}
                          </span>
                        )}
                        {l.rolls != null && <span className="text-faint">{num(l.rolls)} roll</span>}
                      </div>
                    </div>
                  ) : (
                    (lIssued != null || lUsed != null || estNote || lLen != null) && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-1.5 t-xs">
                        {(lIssued != null || lUsed != null) && (
                          <span className="flex items-center gap-3">
                            <span className="text-muted">Issued <b className="tnum text-primary-ink">{lIssued != null ? num(lIssued) : "—"}</b></span>
                            <span className="text-muted">Used <b className="tnum text-primary-ink">{lUsed != null ? num(lUsed) : "—"}</b></span>
                            <span className="text-muted">Extra <b className={`tnum ${lExtra != null && lExtra < 0 ? "text-danger" : "text-ok"}`}>{lExtra != null ? num(lExtra) : "—"}</b></span>
                          </span>
                        )}
                        {lLen != null && <span className="text-faint">length {num(lLen, 1)} m</span>}
                        {lAvgMeasured != null && <span className="text-faint">avg actual {num(lAvgMeasured, 3)}</span>}
                        {estNote && <span className="text-faint">{estNote}</span>}
                      </div>
                    )
                  )}
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
              vendors={vendorNames}
            />
          )}
        </Card>
      )}

      {/* Change 20 Part C.1: finishing given out as job-work, per layer, per vendor.
          The PRINT/LASER/EMB flags above stay as quick planning; these are the record. */}
      <FinishingPanel
        jobCardId={j.id}
        siNo={j.siNo}
        canEdit={canEdit}
        canSeeCost={canSeeCost}
        vendors={vendorNames}
        layers={j.layers.map((l) => ({ id: l.id, label: l.label || `Layer ${l.layerNo}` }))}
        rows={finishingJobs.map((f) => ({
          id: f.id, docNo: f.docNo, process: f.process as string, status: f.status as string,
          vendor: f.vendor.name,
          layers: f.layers.map((x) => x.label || `L${x.layerNo}`),
          issuedDate: f.issuedDate.toISOString(),
          receivedDate: f.receivedDate ? f.receivedDate.toISOString() : null,
          qtyOut: f.qtyOut, qtyBack: f.qtyBack,
          rate: canSeeCost ? f.rate : null,
          billNo: f.billNo, note: f.note,
        }))}
      />

      {/* Change 40 Part K — in-house pressing (moves no stock). */}
      {canEdit && jobPress && <PressPanel jobCardId={j.id} press={jobPress} />}

      {/* Change 17 Part C: challans raised against this job card */}
      {canEdit && (
        <Card className="mt-3.5 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="t-body font-bold">Challans <span className="font-medium text-faint">· {jobChallans.length}</span></h3>
            <div className="flex flex-wrap gap-1.5 t-xs">
              <Link href={`/challans?jobCardId=${j.id}&direction=OUTWARD`} className="rounded-md border border-border bg-surface px-2 py-1 font-semibold text-t1 hover:bg-surface-2">+ Trim / Combined (outward)</Link>
              <Link href={`/challans?jobCardId=${j.id}&direction=INWARD`} className="rounded-md border border-border bg-surface px-2 py-1 font-semibold text-t1 hover:bg-surface-2">+ Fabric (inward)</Link>
            </div>
          </div>
          {jobChallans.length === 0 ? (
            <p className="t-sm text-faint">No challans</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full t-sm">
                <thead>
                  <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                    <th className="px-2 py-2 font-semibold">Challan</th>
                    <th className="px-2 py-2 font-semibold">Kind</th>
                    <th className="px-2 py-2 font-semibold">Dir</th>
                    <th className="px-2 py-2 font-semibold">Party</th>
                    <th className="px-2 py-2 text-right font-semibold">Qty</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobChallans.map((c) => (
                    <tr key={c.id} className="border-b border-hairline">
                      <td className="px-2 py-1.5"><Link href={`/challan-doc/${c.id}`} className="font-semibold text-primary hover:underline">{c.challanNo ?? `Draft #${c.id}`}</Link></td>
                      <td className="px-2 py-1.5">{c.kind ? <Badge tone="primary">{c.kind}</Badge> : <span className="text-faint">—</span>}</td>
                      <td className="px-2 py-1.5 text-faint">{c.direction === "INWARD" ? "IN" : "OUT"}</td>
                      <td className="px-2 py-1.5">{c.counterparty}</td>
                      <td className="px-2 py-1.5 text-right tnum">{num(c.totalQty)}</td>
                      <td className="px-2 py-1.5"><Badge tone={c.status === "LOCKED" ? "ok" : c.status === "VOID" ? "danger" : "default"}>{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* estimate vs actual fabric — per colour */}
      <div id="fabric" />
      <Card className="mt-3.5 p-5">
        <h3 className="mb-3 t-body font-bold">
          Fabric · Estimate vs Actual{" "}
          {hasFabricLines && <span className="font-medium text-faint">· per colour ({unit.toLowerCase()})</span>}
        </h3>
        {hasFabricLines ? (
          <>
          {/* phones: a card per colour */}
          <div className="flex flex-col gap-2 md:hidden">
            {j.fabricLines.map((l) => {
              const ret = returnedByColour.get(colorKey(l.color)) ?? 0;
              return (
                <div key={l.id} className="rounded-lg border border-hairline bg-surface p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 t-sm font-bold text-t1">
                    {l.imageUrl && <img src={l.imageUrl} alt="" className="h-6 w-6 rounded object-cover" />}
                    {l.color || "—"}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 t-sm text-t2">
                    {hasFabricDetail && <span className="tnum">Req pcs <b className="text-t1">{l.reqPcs != null ? num(l.reqPcs) : "—"}</b></span>}
                    {hasFabricDetail && <span className="tnum">Req mtr <b className="text-t1">{l.reqMtr != null ? num(l.reqMtr) : "—"}</b></span>}
                    {hasFabricDetail && <span className="tnum">Rolls <b className="text-t1">{l.rolls != null ? num(l.rolls) : "—"}</b></span>}
                    <span className="tnum">Assumed avg <b className="text-t1">{l.estAvg != null ? num(l.estAvg, 3) : "—"}</b></span>
                    <span className="tnum">Actual avg <b className="text-t1">{l.actualAvg != null ? num(l.actualAvg, 3) : "—"}</b></span>
                    <span className="tnum">GSM <b className="text-t1">{l.gsm ?? fabricGsm ?? "—"}</b></span>
                    <span className="tnum">Width <b className="text-t1">{l.rollWidth ?? fabricWidth ?? "—"}</b></span>
                    <span className="tnum">Issued <b className="text-t1">{l.qtyIssued != null ? num(l.qtyIssued) : "—"}</b></span>
                    <span className="tnum">Used <b className="text-t1">{l.qtyUsed != null ? num(l.qtyUsed) : "—"}</b></span>
                    <span className="tnum">Returned <b className="text-ok">{ret > 0 ? num(ret) : "—"}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
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
                  {/* Change 19 B: a colour can now return more than once, so this is gross. */}
                  <th className="px-2 py-2 text-right font-semibold">Returned (gross)</th>
                </tr>
              </thead>
              <tbody>
                {j.fabricLines.map((l) => {
                  const ret = returnedByColour.get(colorKey(l.color)) ?? 0;
                  return (
                    <tr key={l.id} className="border-b border-hairline last:border-0">
                      <td className="px-2 py-1.5 font-semibold text-t1">
                        <span className="inline-flex items-center gap-1.5">
                          {l.imageUrl && <img src={l.imageUrl} alt="" className="h-6 w-6 rounded object-cover" />}
                          {l.color || "—"}
                        </span>
                      </td>
                      {hasFabricDetail && <td className="px-2 py-1.5 text-right tnum text-t2">{l.reqPcs != null ? num(l.reqPcs) : "—"}</td>}
                      {hasFabricDetail && <td className="px-2 py-1.5 text-right tnum text-t2">{l.reqMtr != null ? num(l.reqMtr) : "—"}</td>}
                      {hasFabricDetail && <td className="px-2 py-1.5 text-right tnum text-t2">{l.rolls != null ? num(l.rolls) : "—"}</td>}
                      <td className="px-2 py-1.5 text-right tnum">{l.estAvg != null ? num(l.estAvg, 3) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.actualAvg != null ? num(l.actualAvg, 3) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-t2">{l.gsm ?? fabricGsm ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-t2">{l.rollWidth ?? fabricWidth ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right font-bold tnum">{l.qtyIssued != null ? num(l.qtyIssued) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.qtyUsed != null ? num(l.qtyUsed) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum text-ok">{ret > 0 ? num(ret) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="grid grid-cols-4 gap-3.5 t-sm">
            {[
              ["Est avg", j.estAvg != null ? `${j.estAvg} ${unit.toLowerCase()}/pc` : "—"],
              ["Est fabric", j.estFabric != null ? `${num(j.estFabric)} ${unit.toLowerCase()}` : "—"],
              ["Actual avg", j.actualAvg != null ? `${j.actualAvg} ${unit.toLowerCase()}/pc` : "—"],
              ["Dispatched", j.fabricDispatched != null ? `${num(j.fabricDispatched)} ${unit.toLowerCase()}` : "—"],
              ["Used", j.fabricUsed != null ? `${num(j.fabricUsed)} ${unit.toLowerCase()}` : "—"],
              ["Returned (gross)", returned > 0 ? `${num(returned)} ${unit.toLowerCase()}` : "—"],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="t-xs text-faint">{l}</div>
                <div className="mt-0.5 font-semibold tnum">{v}</div>
              </div>
            ))}
          </div>
        )}
        {u?.role !== "VENDOR" && j.product?.fabricId != null && (
          <FabricActualsForm jobCardId={j.id} unit={unit} lines={actualsLines} defaultArrangedBy={u?.displayName ?? ""} />
        )}
      </Card>

      {/* Change 36 Part 5 — standard vs actual. A comparison, not a measurement. */}
      {jobYield && jobYield.standard != null && jobYield.actual > 0 && (
        <Card className="mt-3.5 p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="t-body font-bold">Fabric yield</h3>
            <span className="t-sm text-t2">
              Standard <b className="tnum">{num(jobYield.standard, 2)} {jobYield.unit.toLowerCase()}</b>
              {" · "}Actual <b className="tnum">{num(jobYield.actual, 2)} {jobYield.unit.toLowerCase()}</b>
              {jobYield.variance != null && (
                <>
                  {" · "}
                  <b className={`tnum ${jobYield.variance > 0 ? "text-danger" : "text-ok"}`}>
                    {jobYield.variance > 0 ? "+" : ""}{num(jobYield.variance, 2)}
                  </b>
                  {jobYield.yieldPct != null && (
                    <Badge
                      tone={jobYield.yieldPct < 0.9 ? "danger" : jobYield.yieldPct < 0.97 ? "warn" : "ok"}
                      className="ml-1.5"
                    >
                      {pct(jobYield.yieldPct, 1)} yield
                    </Badge>
                  )}
                </>
              )}
            </span>
          </div>
        </Card>
      )}

      {/* Change 36 Part 3 — inspections supersede the card-level figures below, which
          stay readable for cards inspected before this shipped. */}
      {canEdit && (
        <div className="mt-3.5">
          <InspectionPanel
            jobCardId={j.id}
            layers={j.layers.map((l) => ({ id: l.id, layerNo: l.layerNo, label: l.label }))}
            vendors={vendorNames}
            defectTypes={defectTypes.map((d) => ({ id: d.id, name: d.name, category: d.category }))}
            inspections={jobInspections}
            reworks={jobReworks}
          />
        </div>
      )}

      {/* quality / quantity capture (Change 12, Part G) — reject · alter · extra.
          Legacy: shown only where it already carries figures, since inspections are now
          the source. */}
      {(j.rejectQty != null || j.alterQty != null || j.extraQty != null) && (
        <JobQualityCard
          jobCardId={j.id}
          canEdit={canEdit}
          rejectQty={j.rejectQty}
          alterQty={j.alterQty}
          extraQty={j.extraQty}
        />
      )}

      {/* Change 16 Part F: legacy stitch assignments — READ-ONLY history only. Vendor now
          lives on the cutting layer and received qty comes from dispatch (see above). */}
      {legacyStitch.length > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 t-body font-bold">Stitching <span className="font-medium text-faint">· legacy assignments (read-only)</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full t-sm">
              <thead>
                <tr className="border-b border-border text-left t-micro uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">Vendor</th>
                  <th className="px-2 py-2 font-semibold">Colour</th>
                  <th className="px-2 py-2 text-right font-semibold">Lot</th>
                  <th className="px-2 py-2 text-right font-semibold">Received</th>
                  <th className="px-2 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {legacyStitch.map((s) => (
                  <tr key={s.id} className="border-b border-hairline last:border-0">
                    <td className="px-2 py-1.5 font-semibold text-t1">{s.vendorName}</td>
                    <td className="px-2 py-1.5 text-t2">{s.colour || "—"}</td>
                    <td className="px-2 py-1.5 text-right tnum">{s.lotQty != null ? num(s.lotQty) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tnum">{num(s.received)}</td>
                    <td className="px-2 py-1.5 text-right tnum">{s.balance != null ? num(s.balance) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* size×color grand roll-up (across layers) */}
      {mx.total > 0 && (
        <Card className="mt-3.5 p-5">
          <h3 className="mb-3 t-body font-bold">Size {hasColor ? "× Colour" : ""} Breakup <span className="font-medium text-faint">· grand total</span></h3>
          {hasColor ? (
            <>
            {/* phones: a card per colour + a totals summary card */}
            <div className="flex flex-col gap-2 md:hidden">
              {mx.colours.map((c) => (
                <div key={c || "—"} className="rounded-lg border border-hairline bg-surface p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="t-sm font-bold text-t1">{c === "" ? "—" : c}</span>
                    <span className="t-sm font-bold tnum text-primary-ink">{num(mx.byColour.find((b) => b.colour === c)?.qty ?? 0)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {mx.sizes.map((s) => {
                      const q = mx.cell(c, s);
                      return q ? (
                        <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 t-micro font-semibold tnum text-t2">{s} {num(q)}</span>
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="t-sm font-bold text-primary-ink">Total</span>
                  <span className="t-sm font-extrabold tnum text-primary-ink">{num(mx.total)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {mx.sizes.map((s) => (
                    <span key={s} className="rounded bg-surface px-1.5 py-0.5 t-micro font-semibold tnum text-t2">{s} {num(mx.bySize.find((b) => b.size === s)?.qty ?? 0)}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-center t-sm">
                <thead>
                  <tr className="t-micro font-bold uppercase tracking-wide text-faint">
                    <th className="px-2 py-1.5 text-left">Colour</th>
                    {mx.sizes.map((s) => <th key={s} className="px-2 py-1.5">{s}</th>)}
                    <th className="px-2 py-1.5 text-primary-ink">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mx.colours.map((c) => (
                    <tr key={c} className="border-t border-hairline">
                      <td className="px-2 py-1.5 text-left font-semibold text-t1">{c === "" ? "—" : c}</td>
                      {mx.sizes.map((s) => <td key={s} className="px-2 py-1.5 tnum">{mx.cell(c, s) || ""}</td>)}
                      <td className="px-2 py-1.5 font-bold text-primary-ink tnum">{num(mx.byColour.find((b) => b.colour === c)?.qty ?? 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border">
                    <td className="px-2 py-1.5 text-left t-micro font-bold text-primary-ink">Total</td>
                    {mx.sizes.map((s) => <td key={s} className="px-2 py-1.5 font-bold tnum">{num(mx.bySize.find((b) => b.size === s)?.qty ?? 0)}</td>)}
                    <td className="px-2 py-1.5 font-extrabold text-primary-ink tnum">{num(mx.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${mx.sizes.length + 1}, minmax(0, 1fr))` }}>
              {mx.sizes.map((s) => (
                <div key={s}>
                  <div className="t-xs font-bold text-faint">{s}</div>
                  <div className="mt-1 rounded-lg border border-border bg-surface-2 py-2.5 t-head font-bold tnum">{num(mx.bySize.find((b) => b.size === s)?.qty ?? 0)}</div>
                </div>
              ))}
              <div>
                <div className="t-xs font-bold text-primary-ink">Total</div>
                <div className="mt-1 rounded-lg bg-primary-soft py-2.5 t-head font-bold text-primary-ink tnum">{num(mx.total)}</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Trim sheet — required (plan) vs issued (locked outward challans), Change 19 A.4 */}
      <div id="trims" />
      {j.jobLines.length > 0 && (
        <>
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
              trimItemId: l.trimItemId ?? null,
              issuedFromChallans: l.trimItemId != null ? trimIssues.get(l.trimItemId)?.locked ?? 0 : undefined,
              pendingFromDrafts: l.trimItemId != null ? trimIssues.get(l.trimItemId)?.draft ?? 0 : undefined,
            }))}
          />
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <JobTrimChallanButton jobCardId={j.id} />
              <span className="t-xs text-faint">
                
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
