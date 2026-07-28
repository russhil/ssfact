import { db } from "@/lib/db";
import { splitByLayerVendor, LAYER_VENDOR_INCLUDE } from "@/lib/vendor-split";

/**
 * Change 36 Part 4 — can we take it, and when?
 *
 * ssfact is entirely reactive: it records what a vendor did, never what a vendor CAN do.
 * plannedEtd exists but nothing checks it against load, so the owner guesses.
 *
 * ★ Capacity is DERIVED, plus ONE entered ceiling (pieces/day). No scheduler — a clear
 * load view the owner trusts beats a perfect algorithm he doesn't.
 *
 * Two traps this deliberately avoids:
 *
 * - Load MUST be layer-based. A header-vendor roll-up attributes a split card 100% to
 *   one vendor, which is exactly the bug Change 19 C exists to fix and would make
 *   /planning contradict /vendors/[name]. Everything goes through splitByLayerVendor.
 *
 * - "Unassigned" is a REAL Vendor row that createJobCard falls back to. A load board
 *   that does not filter it shows a phantom bottleneck at the top of the list.
 */

const DAY = 86400000;
const UNASSIGNED = "Unassigned";

export type VendorLoad = {
  vendorId: number | null;
  vendor: string;
  kind: string;
  /** null = not set. No capacity means no projection, never a guessed one. */
  capacityPcs: number | null;
  capacityNote: string | null;
  /** Pieces cut and not yet returned. CAN be negative — extra pieces come back. */
  openPcs: number;
  cutPcs: number;
  dispatchedPcs: number;
  cards: number;
  /** open ÷ capacity, rounded up. Null when capacity is unset or open <= 0. */
  daysToClear: number | null;
  /** The soonest ETD among this vendor's open cards. */
  nearestEtd: Date | null;
  /** Days until nearestEtd. Negative = already past. */
  daysToEtd: number | null;
  /** True when the backlog cannot clear before the nearest ETD. */
  overCommitted: boolean;
  overdueCards: number;
};

function midnight(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export async function getVendorLoad(): Promise<VendorLoad[]> {
  const [jobs, vendors] = await Promise.all([
    db.jobCard.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true, cutQty: true, dispatchedQty: true, plannedEtd: true,
        vendor: { select: { name: true } },
        ...LAYER_VENDOR_INCLUDE,
      },
    }),
    db.vendor.findMany({
      where: { active: true },
      select: { id: true, name: true, kind: true, dailyCapacityPcs: true, capacityNote: true },
    }),
  ]);

  const today = midnight(new Date());
  const acc = new Map<string, { open: number; cut: number; disp: number; cards: number; etd: Date | null; overdue: number }>();

  for (const j of jobs) {
    for (const s of splitByLayerVendor(j as never)) {
      if (s.vendor === UNASSIGNED) continue;
      const g = acc.get(s.vendor) ?? { open: 0, cut: 0, disp: 0, cards: 0, etd: null, overdue: 0 };
      const open = s.cutQty - s.dispatchedQty;
      g.open += open;
      g.cut += s.cutQty;
      g.disp += s.dispatchedQty;
      g.cards += 1;
      if (j.plannedEtd && open > 0) {
        if (g.etd == null || j.plannedEtd < g.etd) g.etd = j.plannedEtd;
        if (midnight(j.plannedEtd) < today) g.overdue += 1;
      }
      acc.set(s.vendor, g);
    }
  }

  return vendors
    .filter((v) => v.name !== UNASSIGNED)
    .map((v) => {
      const g = acc.get(v.name) ?? { open: 0, cut: 0, disp: 0, cards: 0, etd: null, overdue: 0 };
      const openPcs = Math.round(g.open * 100) / 100;
      const cap = v.dailyCapacityPcs;

      // Guard every degenerate case: no capacity, zero capacity, and a negative backlog
      // (dispatch is deliberately never clamped, so extra pieces returned make open < 0).
      const daysToClear = cap != null && cap > 0 && openPcs > 0 ? Math.ceil(openPcs / cap) : null;
      const daysToEtd = g.etd ? Math.round((midnight(g.etd) - today) / DAY) : null;

      return {
        vendorId: v.id,
        vendor: v.name,
        kind: v.kind as string,
        capacityPcs: cap,
        capacityNote: v.capacityNote,
        openPcs,
        cutPcs: Math.round(g.cut * 100) / 100,
        dispatchedPcs: Math.round(g.disp * 100) / 100,
        cards: g.cards,
        daysToClear,
        nearestEtd: g.etd,
        daysToEtd,
        overCommitted: daysToClear != null && daysToEtd != null && daysToClear > daysToEtd,
        overdueCards: g.overdue,
      };
    })
    .sort((a, b) => Number(b.overCommitted) - Number(a.overCommitted) || b.openPcs - a.openPcs);
}

/**
 * When could this vendor realistically finish `qty` more pieces, given what they already
 * owe? Returns null when no capacity is set — a projection nobody entered a number for
 * is a guess dressed as a fact.
 */
export async function projectEtd(vendorName: string, qty: number): Promise<{ days: number; date: Date } | null> {
  const load = (await getVendorLoad()).find((l) => l.vendor === vendorName);
  if (!load || load.capacityPcs == null || load.capacityPcs <= 0) return null;
  const backlog = Math.max(0, load.openPcs) + Math.max(0, qty);
  const days = Math.ceil(backlog / load.capacityPcs);
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { days, date };
}
