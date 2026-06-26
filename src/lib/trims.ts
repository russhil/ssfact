import { db } from "@/lib/db";

export type TrimStock = {
  id: number;
  name: string;
  sno: string | null;
  family: string | null;
  opening: number;
  current: number;
  inTotal: number;
  outTotal: number;
  usedPct: number;
  status: "ok" | "low" | "short";
};

/**
 * Trim stock. Unlike fabric, `current` is the authoritative physical snapshot from
 * the TIRMS register — NOT recomputed from movements (the IN/OUT ledger is partial).
 * Movements are surfaced for reconciliation only.
 */
export async function getTrimStock(): Promise<TrimStock[]> {
  const items = await db.trimItem.findMany({ include: { movements: true }, orderBy: { name: "asc" } });
  return items
    .map((t) => {
      const inTotal = t.movements.filter((m) => m.type === "RECEIPT").reduce((a, m) => a + m.qty, 0);
      const outTotal = t.movements.filter((m) => m.type === "ISSUE").reduce((a, m) => a + m.qty, 0);
      const consumed = t.openingStock - t.currentStock;
      const usedPct =
        t.openingStock > 0 ? Math.min(1, Math.max(0, consumed / t.openingStock)) : t.currentStock <= 0 ? 1 : 0;
      const status: TrimStock["status"] = t.currentStock <= 0 ? "short" : usedPct >= 0.85 ? "low" : "ok";
      return {
        id: t.id,
        name: t.name,
        sno: t.sno,
        family: t.family,
        opening: t.openingStock,
        current: t.currentStock,
        inTotal,
        outTotal,
        usedPct,
        status,
      };
    })
    .sort((a, b) => (b.status === "short" ? 1 : 0) - (a.status === "short" ? 1 : 0) || b.usedPct - a.usedPct);
}

export type TrimSummary = {
  total: number;
  totalUnits: number;
  low: number;
  short: number;
  families: number;
};

export async function getTrimSummary(): Promise<TrimSummary> {
  const stock = await getTrimStock();
  return {
    total: stock.length,
    totalUnits: stock.reduce((a, s) => a + Math.max(0, s.current), 0),
    low: stock.filter((s) => s.status === "low").length,
    short: stock.filter((s) => s.status === "short").length,
    families: new Set(stock.map((s) => s.family).filter(Boolean)).size,
  };
}

export async function getTrimItem(id: number) {
  return db.trimItem.findUnique({ where: { id } });
}

export async function getTrimLedger(trimItemId: number) {
  return db.trimMovement.findMany({ where: { trimItemId }, orderBy: [{ date: "desc" }, { id: "desc" }], take: 50 });
}
