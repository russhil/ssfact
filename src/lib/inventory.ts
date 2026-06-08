import { db } from "@/lib/db";

export type FabricStock = {
  id: number;
  name: string;
  unit: string;
  opening: number;
  issued: number;
  received: number;
  available: number;
  usedPct: number;
};

export async function getFabricStock(): Promise<FabricStock[]> {
  const fabrics = await db.fabric.findMany({
    include: { movements: true },
    orderBy: { name: "asc" },
  });
  return fabrics
    .map((f) => {
      const issued = f.movements.filter((m) => m.type === "ISSUE").reduce((a, m) => a + m.qty, 0);
      const received = f.movements.filter((m) => m.type === "RECEIPT").reduce((a, m) => a + m.qty, 0);
      const available = f.openingStock + received - issued;
      const usedPct = f.openingStock + received > 0 ? issued / (f.openingStock + received) : 0;
      return {
        id: f.id,
        name: f.name,
        unit: f.unit,
        opening: f.openingStock,
        issued,
        received,
        available,
        usedPct,
      };
    })
    .sort((a, b) => b.usedPct - a.usedPct);
}

export type StyleOption = {
  id: number;
  styleNo: string;
  itemDesc: string;
  mrp: number | null;
  avgConsumption: number | null;
  unit: string;
  fabricId: number | null;
  fabricName: string | null;
  fabricAvailable: number | null;
};

export async function getStyleOptions(): Promise<StyleOption[]> {
  const [styles, stock] = await Promise.all([
    db.style.findMany({ include: { fabric: true }, orderBy: { styleNo: "asc" } }),
    getFabricStock(),
  ]);
  const stockById = new Map(stock.map((s) => [s.id, s.available]));
  return styles.map((s) => ({
    id: s.id,
    styleNo: s.styleNo,
    itemDesc: s.itemDesc,
    mrp: s.mrp,
    avgConsumption: s.avgConsumption,
    unit: s.unit,
    fabricId: s.fabricId,
    fabricName: s.fabric?.name ?? null,
    fabricAvailable: s.fabricId ? stockById.get(s.fabricId) ?? null : null,
  }));
}

export async function getFabricLedger(fabricId: number) {
  return db.stockMovement.findMany({
    where: { fabricId },
    include: { jobCard: { include: { style: true } } },
    orderBy: { date: "desc" },
    take: 50,
  });
}
