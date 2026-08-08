/**
 * Change 40 Part L — per-firm stock scoping, the greppable counterpart to POSTED in
 * job-scope.ts.
 *
 * Sport Sun runs two physical firm-factories (Ravan Riti, Jahangir Puri). Stock belongs to a
 * firm; a job card consumes only its own firm's stock; the other firm's stock is visible but
 * never consumable. The legacy `currentStock` scalar on FabricColor/TrimItem stays as the
 * ALL-FIRMS total (invariant: currentStock == Σ firmStocks.currentStock), so every un-converted
 * read keeps working and means "across all factories". Convert a read to firm scope by reading
 * through `stockFor(...)`, exactly as POSTED made draft-exclusion auditable by grep.
 *
 * A firm is a Buyer row with holdsStock = true (see Buyer.holdsStock).
 */

import { db } from "@/lib/db";

/** Spread into a `where` to scope a per-firm-stock query, or `{}` for the all-firms view. */
export const firmWhere = (buyerId?: number | null) => (buyerId ? { buyerId } : {});

/** The Buyer rows that actually hold stock — every firm picker in Change 40 lists these only. */
export async function listFirms() {
  return db.buyer.findMany({
    where: { holdsStock: true, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * A fabric-colour's balance for one firm, or the all-firms total when `buyerId` is null.
 * Returns the child-row balance when firm-scoped; falls back to the legacy total otherwise.
 */
export async function fabricStockFor(fabricColorId: number, buyerId?: number | null): Promise<number> {
  if (buyerId == null) {
    const fc = await db.fabricColor.findUnique({ where: { id: fabricColorId }, select: { currentStock: true } });
    return fc?.currentStock ?? 0;
  }
  const row = await db.fabricColorStock.findUnique({
    where: { fabricColorId_buyerId: { fabricColorId, buyerId } },
    select: { currentStock: true },
  });
  return row?.currentStock ?? 0;
}

/** A trim item's balance for one firm, or the all-firms total when `buyerId` is null. */
export async function trimStockFor(trimItemId: number, buyerId?: number | null): Promise<number> {
  if (buyerId == null) {
    const t = await db.trimItem.findUnique({ where: { id: trimItemId }, select: { currentStock: true } });
    return t?.currentStock ?? 0;
  }
  const row = await db.trimItemStock.findUnique({
    where: { trimItemId_buyerId: { trimItemId, buyerId } },
    select: { currentStock: true },
  });
  return row?.currentStock ?? 0;
}
