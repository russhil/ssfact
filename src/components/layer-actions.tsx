"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCuttingLayer, removeCuttingLayer } from "@/lib/actions";
import { Button, Field, Input, Sheet } from "@/components/ui";
import { num } from "@/lib/format";
import { Pencil, Trash2 } from "lucide-react";

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
  /** Change 37 — this lay's per-colour fabric, when it has any. */
  colours: { colour: string; fabricIssued: number | null; fabricUsed: number | null }[];
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
  const [colF, setColF] = useState<Record<string, { issued: string; used: string }>>(() =>
    Object.fromEntries(
      layer.colours.map((c) => [c.colour, {
        issued: c.fabricIssued != null ? String(c.fabricIssued) : "",
        used: c.fabricUsed != null ? String(c.fabricUsed) : "",
      }])
    )
  );
  const cf = (c: string) => colF[c] ?? { issued: "", used: "" };
  const setCf = (c: string, k: "issued" | "used", v: string) =>
    setColF((p) => ({ ...p, [c]: { ...(p[c] ?? { issued: "", used: "" }), [k]: v } }));

  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  const colourNames = layer.colours.map((c) => c.colour);
  const hasColours = colourNames.length > 0;
  const sumCf = (k: "issued" | "used") => {
    const v = colourNames.map((c) => numOrNull(cf(c)[k])).filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  const effIssued = hasColours ? sumCf("issued") : numOrNull(issued);
  const effUsed = hasColours ? sumCf("used") : numOrNull(used);
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
          ? colourNames.map((c) => ({ colour: c, issued: numOrNull(cf(c).issued), used: numOrNull(cf(c).used) }))
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
          <div className="rounded-lg border border-hairline">
            <div className="overflow-x-auto">
              <table className="w-full t-sm">
                <thead>
                  <tr className="t-micro font-bold text-faint">
                    <th className="px-2 py-1 text-left">Colour</th>
                    <th className="px-2 py-1 text-right">Issued</th>
                    <th className="px-2 py-1 text-right">Used</th>
                    <th className="px-2 py-1 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {colourNames.map((c) => {
                    const i = numOrNull(cf(c).issued);
                    const u = numOrNull(cf(c).used);
                    const bal = i != null || u != null ? Math.round(((i ?? 0) - (u ?? 0)) * 100) / 100 : null;
                    return (
                      <tr key={c} className="border-t border-hairline">
                        <td className="px-2 py-1 font-semibold text-t1">{c || "—"}</td>
                        <td className="px-1 py-1">
                          <Input type="number" step="any" value={cf(c).issued} onChange={(e) => setCf(c, "issued", e.target.value)} placeholder="—" className="text-right tnum" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" step="any" value={cf(c).used} onChange={(e) => setCf(c, "used", e.target.value)} placeholder="—" className="text-right tnum" />
                        </td>
                        <td className={`px-2 py-1 text-right tnum font-semibold ${bal != null && bal < 0 ? "text-danger" : "text-t1"}`}>
                          {bal != null ? num(bal, 2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border">
                    <td className="px-2 py-1 t-xs font-bold text-faint">Layer</td>
                    <td className="px-2 py-1 text-right tnum font-bold">{effIssued != null ? num(effIssued, 2) : "—"}</td>
                    <td className="px-2 py-1 text-right tnum font-bold">{effUsed != null ? num(effUsed, 2) : "—"}</td>
                    <td className="px-2 py-1" />
                  </tr>
                </tbody>
              </table>
            </div>
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
