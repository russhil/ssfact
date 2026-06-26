import { db } from "@/lib/db";
import { getTrimStock } from "@/lib/trims";

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

// Default size ratio when a product has no per-product sizeRatioJson.
export const DEFAULT_SIZE_RATIO: [string, number][] = [
  ["S", 0.08], ["M", 0.17], ["L", 0.25], ["XL", 0.25], ["2XL", 0.17], ["3XL", 0.08],
];

export type JobProductOption = {
  id: number;
  styleNo: string;
  sku: string;
  itemDesc: string;
  mrp: number | null;
  avgConsumption: number | null;
  unit: string;
  fabricId: number | null;
  fabricName: string | null;
  fabricAvailable: number | null;
  imageUrl: string | null;
  colors: { name: string; hex: string | null }[];
  sizeRatio: [string, number][];
  colorRatio: [string, number][];
  bom: {
    material: string;
    color: string | null;
    perPieceQty: number | null;
    trimItemId: number | null;
    trimName: string | null;
    trimCurrent: number | null;
  }[];
};

function parseRatio(json: string | null | undefined): [string, number][] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as [string, number][];
  } catch {
    /* ignore malformed JSON, fall back to default */
  }
  return null;
}

/** Everything the job-card form needs, per product: spec, colors, ratios, BOM + live trim stock. */
export async function getJobProductOptions(): Promise<JobProductOption[]> {
  const [products, fabricStock, trimStock] = await Promise.all([
    db.product.findMany({
      include: {
        fabric: true,
        colors: { orderBy: { sortOrder: "asc" } },
        boms: { include: { lines: { include: { trimItem: true } } } },
      },
      orderBy: [{ styleNo: "asc" }, { skuCode: "asc" }],
    }),
    getFabricStock(),
    getTrimStock(),
  ]);
  const fabricAvail = new Map(fabricStock.map((s) => [s.id, s.available]));
  const trimById = new Map(trimStock.map((t) => [t.id, t]));

  return products.map((p) => {
    const colors = p.colors.map((c) => ({ name: c.name, hex: c.hex }));
    const colorRatio =
      parseRatio(p.colorRatioJson) ??
      (colors.length > 0
        ? colors.map((c) => [c.name, 1 / colors.length] as [string, number])
        : []);
    const bom = p.boms.flatMap((b) =>
      b.lines.map((l) => {
        const trim = l.trimItem ? trimById.get(l.trimItem.id) : null;
        return {
          material: l.material,
          color: l.color,
          perPieceQty: l.qty,
          trimItemId: l.trimItemId,
          trimName: l.trimItem?.name ?? null,
          trimCurrent: l.trimItem ? trim?.current ?? l.trimItem.currentStock : null,
        };
      })
    );
    return {
      id: p.id,
      styleNo: p.styleNo ?? p.skuCode,
      sku: p.skuCode,
      itemDesc: p.itemDesc ?? p.name,
      mrp: p.mrp,
      avgConsumption: p.avgConsumption,
      unit: p.unit,
      fabricId: p.fabricId,
      fabricName: p.fabric?.name ?? null,
      fabricAvailable: p.fabricId ? fabricAvail.get(p.fabricId) ?? null : null,
      imageUrl: p.imageUrl,
      colors,
      sizeRatio: parseRatio(p.sizeRatioJson) ?? DEFAULT_SIZE_RATIO,
      colorRatio,
      bom,
    };
  });
}

export async function getFabricLedger(fabricId: number) {
  return db.stockMovement.findMany({
    where: { fabricId },
    include: { jobCard: { include: { product: true } } },
    orderBy: { date: "desc" },
    take: 50,
  });
}
