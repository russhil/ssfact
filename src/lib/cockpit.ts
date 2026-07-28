import "server-only";
import { getVendorLoad } from "@/lib/capacity";
import { getPayables } from "@/lib/party-ledger";

/**
 * Change 36 Part 9 Part D — the derivations the owner cockpit adds.
 *
 * Kept out of app/(app)/page.tsx deliberately: that page is already ~160 lines and
 * getDashboard() loads every job card with vendor+product+layer includes on every render.
 * Bolting four more widgets into the same Promise.all would make the slowest page in the
 * app slower still, and would bury the gating.
 *
 * Everything here is COST data, so the page must call it only when canSeeCost(user) —
 * the discipline /reports already follows: don't render it, and don't even query it.
 */

export type CockpitCapacity = {
  overCommitted: { vendor: string; openPcs: number; daysToClear: number | null; daysToEtd: number | null }[];
  noCapacity: number;
  totalOpen: number;
};

export async function getCockpitCapacity(): Promise<CockpitCapacity> {
  const load = await getVendorLoad();
  return {
    overCommitted: load
      .filter((l) => l.overCommitted)
      .slice(0, 5)
      .map((l) => ({ vendor: l.vendor, openPcs: l.openPcs, daysToClear: l.daysToClear, daysToEtd: l.daysToEtd })),
    noCapacity: load.filter((l) => l.openPcs > 0 && l.capacityPcs == null).length,
    totalOpen: Math.round(load.reduce((a, l) => a + Math.max(0, l.openPcs), 0) * 100) / 100,
  };
}

export type CockpitPayables = {
  parties: { name: string; kind: "VENDOR" | "SUPPLIER"; partyId: number; outstanding: number; aged90: number }[];
  total: number;
  agedCount: number;
};

export async function getCockpitPayables(): Promise<CockpitPayables> {
  const rows = await getPayables();
  const owed = rows.filter((p) => p.outstanding > 0);
  return {
    parties: owed.slice(0, 5).map((p) => ({
      name: p.name, kind: p.kind, partyId: p.partyId,
      outstanding: p.outstanding, aged90: p.ageing.d90plus,
    })),
    total: Math.round(owed.reduce((a, p) => a + p.outstanding, 0) * 100) / 100,
    agedCount: owed.filter((p) => p.ageing.d90plus > 0).length,
  };
}
