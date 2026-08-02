"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCuttingLayer, removeCuttingLayer } from "@/lib/actions";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { num } from "@/lib/format";
import { Pencil, Trash2 } from "lucide-react";
// Change 38 Part D — the per-colour fabric editor is one shared table now.
import { LayerFabricTable, type LayerFabricRow } from "@/components/job-card/layer-grid";

/**
 * Change 22 Part D — a cutting layer stops being immutable.
 *
 * addCuttingLayer could append a lay but nothing could correct one: a layer with the wrong
 * vendor, roll count, or fabric-used figure was stuck. Removing a layer reverses the fabric
 * it was issued and takes its pieces back off the card, and is refused once the layer has
 * been dispatched against — you can't un-cut cloth that has come back stitched.
 *
 * Editing the cells changes the card's cut quantity but deliberately does NOT re-post
 * fabric: fabric is trued up in exactly one place (the actuals form), and posting here too
 * would double-count the lay.
 */

export type LayerEditable = {
  id: number;
  layerNo: number;
  label: string | null;
  cutDate: string | null; // yyyy-mm-dd
  vendor: string | null;
  cuttingMaster: string | null;
  rolls: number | null;
  fabricMtr: number | null;
  fabricIssued: number | null;
  fabricBalance: number | null;
  avgConsumption: number | null;
  /** Change 37 — this lay's per-colour fabric, when it has any. Change 38: balance is stored. */
  colours: { colour: string; fabricIssued: number | null; fabricBalance: number | null; fabricUsed: number | null }[];
  total: number;
  /** live (non-voided) dispatches booked against this layer */
  dispatched: number;
};

export function LayerActions({
  layer,
  vendors,
  masters,
  unit,
}: {
  layer: LayerEditable;
  vendors: string[];
  masters: string[];
  unit: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState(layer.label ?? "");
  const [cutDate, setCutDate] = useState(layer.cutDate ?? "");
  const [vendor, setVendor] = useState(layer.vendor ?? "");
  const [master, setMaster] = useState(layer.cuttingMaster ?? "");
  const [rolls, setRolls] = useState(layer.rolls != null ? String(layer.rolls) : "");
  const [used, setUsed] = useState(layer.fabricMtr != null ? String(layer.fabricMtr) : "");
  const [issued, setIssued] = useState(layer.fabricIssued != null ? String(layer.fabricIssued) : "");
  const [balance, setBalance] = useState(layer.fabricBalance != null ? String(layer.fabricBalance) : "");
  const [avg, setAvg] = useState(layer.avgConsumption != null ? String(layer.avgConsumption) : "");

  // Change 37 — edit fabric per colour. Editing these RE-DRIVES the ledger (netting, so
  // it converges rather than stacking); a layer with no colour rows still posts nothing.
  // Change 38 Part B — issued + balance are typed, used is derived. Rows written before the
  // backfill fall back to issued − used so an old lay still opens with the right balance.
  const [colF, setColF] = useState<Record<string, LayerFabricRow>>(() =>
    Object.fromEntries(
      layer.colours.map((c) => [c.colour, {
        issued: c.fabricIssued != null ? String(c.fabricIssued) : "",
        balance:
          c.fabricBalance != null
            ? String(c.fabricBalance)
            : c.fabricIssued != null && c.fabricUsed != null
              ? String(Math.round((c.fabricIssued - c.fabricUsed) * 100) / 100)
              : "",
      }])
    )
  );
  const cf = (c: string) => colF[c] ?? { issued: "", balance: "" };
  const setCf = (c: string, k: keyof LayerFabricRow, v: string) =>
    setColF((p) => ({ ...p, [c]: { ...(p[c] ?? { issued: "", balance: "" }), [k]: v } }));

  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  const colourNames = layer.colours.map((c) => c.colour);
  const hasColours = colourNames.length > 0;
  const sumCf = (k: keyof LayerFabricRow) => {
    const v = colourNames.map((c) => numOrNull(cf(c)[k])).filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  const effIssued = hasColours ? sumCf("issued") : numOrNull(issued);
  const effBalance = hasColours ? sumCf("balance") : numOrNull(balance);
  const effUsed = hasColours
    ? effIssued != null || effBalance != null
      ? Math.round(((effIssued ?? 0) - (effBalance ?? 0)) * 100) / 100
      : null
    : numOrNull(used);
  const extra = effIssued != null ? Math.round((effIssued - (effUsed ?? 0)) * 100) / 100 : null;

  async function save() {
    setBusy(true);
    try {
      await updateCuttingLayer({
        id: layer.id,
        label: label.trim() || null,
        cutDate: cutDate || null,
        vendorName: vendor.trim() || null,
        cuttingMaster: master.trim() || null,
        rolls: numOrNull(rolls),
        fabricMtr: numOrNull(used),
        fabricIssued: numOrNull(issued),
        fabricBalance: numOrNull(balance),
        avgConsumption: numOrNull(avg),
        fabricByColour: hasColours
          ? colourNames.map((c) => ({ colour: c, issued: numOrNull(cf(c).issued), balance: numOrNull(cf(c).balance) }))
          : undefined,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const msg = [
      `Remove layer ${layer.layerNo}?`,
      "",
      `Its ${num(layer.total)} pieces come off the card's cut quantity and the fabric it was issued goes back to stock.`,
      "",
      "This cannot be undone.",
    ].join("\n");
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await removeCuttingLayer({ id: layer.id });
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="inline-flex items-center gap-1.5 no-print">
        <button
          onClick={() => setOpen(true)}
          disabled={busy}
          title={`Edit layer ${layer.layerNo}`}
          className="t-xs font-semibold text-t3 hover:text-primary-ink disabled:opacity-40"
        >
          <Pencil size={12} />
        </button>
      </span>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Layer ${layer.layerNo}`}
        subtitle={`${num(layer.total)} pcs${layer.dispatched > 0 ? ` · ${num(layer.dispatched)} dispatched` : ""}`}
        width={440}
        footer={
          <>
            <Button variant="primary" className="flex-1" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save layer"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`LAYER-${layer.layerNo}`} />
          </Field>
          <Field label="Cut date">
            <Input type="date" value={cutDate} onChange={(e) => setCutDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Stitching vendor">
          <Input list="layer-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="—" />
        </Field>
        <datalist id="layer-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>

        <Field label="Cutting master">
          <Input list="layer-masters" value={master} onChange={(e) => setMaster(e.target.value)} placeholder="—" />
        </Field>
        <datalist id="layer-masters">{masters.map((m) => <option key={m} value={m} />)}</datalist>

        {/* Change 37 — a lay that carries per-colour rows is edited colour by colour, and
            the layer figures become their Σ. Editing used here re-drives the ledger. */}
        {hasColours ? (
          <div>
            <LayerFabricTable colours={colourNames} rows={colF} onChange={setCf} />
            <p className="mt-1 t-xs text-t3">
              Layer <b className="tnum text-t1">{effIssued != null ? num(effIssued, 2) : "—"}</b> issued ·{" "}
              <b className="tnum text-t1">{effBalance != null ? num(effBalance, 2) : "—"}</b> balance ·{" "}
              <b className="tnum text-t1">{effUsed != null ? num(effUsed, 2) : "—"}</b> used
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Fabric issued (${unit.toLowerCase()})`}>
              <Input type="number" step="any" value={issued} onChange={(e) => setIssued(e.target.value)} placeholder="—" className="text-right tnum" />
            </Field>
            <Field label={`Fabric used (${unit.toLowerCase()})`}>
              <Input type="number" step="any" value={used} onChange={(e) => setUsed(e.target.value)} placeholder="—" className="text-right tnum" />
            </Field>
          </div>
        )}
        {extra != null && (
          <p className="-mt-2 t-xs text-t3">
            Extra = issued − used ={" "}
            <b className={extra < 0 ? "text-danger" : "text-ok"}>{num(extra)}</b>
            {extra < 0 && " (short-issued)"}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Rolls">
            <Input type="number" value={rolls} onChange={(e) => setRolls(e.target.value)} placeholder="—" className="text-right tnum" />
          </Field>
          <Field label="Balance">
            <Input type="number" step="any" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="—" className="text-right tnum" />
          </Field>
          <Field label="Avg / pc">
            <Input type="number" step="any" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="—" className="text-right tnum" />
          </Field>
        </div>

        <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
          <div className="t-xs font-bold uppercase tracking-wide text-danger">Remove this layer</div>
          <p className="mt-1 t-xs text-t2">
            {layer.dispatched > 0 ? (
              <>
                Blocked: {num(layer.dispatched)} pieces have been dispatched against this layer. Void those
                dispatches first.
              </>
            ) : (
              <>Removes {num(layer.total)} pcs from the card and reverses the fabric issued.</>
            )}
          </p>
          <Button variant="danger" size="sm" className="mt-2" onClick={remove} disabled={busy || layer.dispatched > 0}>
            <Trash2 size={13} /> Remove layer {layer.layerNo}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
