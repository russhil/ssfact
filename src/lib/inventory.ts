import { db } from "@/lib/db";
import { getTrimStock } from "@/lib/trims";
import { colorKey } from "@/lib/colour";

export type StockStatus = "OK" | "Low" | "Indent";

export function stockStatus(available: number, usedPct: number): StockStatus {
  if (available <= 0) return "Indent";
  if (usedPct >= 0.85) return "Low";
  return "OK";
}

export type FabricColorStock = {
  id: number;
  color: string;
  opening: number;
  current: number;
  usedPct: number;
  status: StockStatus;
};

export type FabricSupplierInfo = { id: number; name: string; rate: number | null };

export type FabricStock = {
  id: number;
  name: string;
  unit: string;
  // master presets
  gsm: number | null;
  rollWidth: number | null;
  form: string | null;
  ratePerUnit: number | null;
  suppliers: FabricSupplierInfo[];
  // stock roll-up
  opening: number;
  issued: number;
  received: number;
  available: number;
  usedPct: number;
  colors: FabricColorStock[]; // per-colour balances (empty for legacy colourless fabrics)
};

export async function getFabricStock(): Promise<FabricStock[]> {
  const fabrics = await db.fabric.findMany({
    include: {
      movements: true,
      colors: { orderBy: { color: "asc" } },
      suppliers: { orderBy: { name: "asc" } },
    },
    orderBy: { name: "asc" },
  });
  return fabrics
    .map((f) => {
      const issued = f.movements.filter((m) => m.type === "ISSUE").reduce((a, m) => a + m.qty, 0);
      const received = f.movements.filter((m) => m.type === "RECEIPT").reduce((a, m) => a + m.qty, 0);

      const colors: FabricColorStock[] = f.colors.map((c) => {
        const usedPct = c.openingStock > 0 ? (c.openingStock - c.currentStock) / c.openingStock : 0;
        return {
          id: c.id,
          color: c.color,
          opening: c.openingStock,
          current: c.currentStock,
          usedPct,
          status: stockStatus(c.currentStock, usedPct),
        };
      });

      // When the fabric is held per colour, the per-colour snapshot is authoritative
      // (mirrors the trims store). Otherwise fall back to the movement-derived balance.
      let opening: number;
      let available: number;
      if (colors.length > 0) {
        opening = colors.reduce((a, c) => a + c.opening, 0);
        available = colors.reduce((a, c) => a + c.current, 0);
      } else {
        opening = f.openingStock;
        available = f.openingStock + received - issued;
      }
      const usedPct = opening > 0 ? (opening - available) / opening : 0;

      return {
        id: f.id,
        name: f.name,
        unit: f.unit,
        gsm: f.gsm,
        rollWidth: f.rollWidth,
        form: f.form,
        ratePerUnit: f.ratePerUnit,
        suppliers: f.suppliers.map((s) => ({ id: s.id, name: s.name, rate: s.rate })),
        opening,
        issued,
        received,
        available,
        usedPct,
        colors,
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
  // fabric master presets (defaults for the lay; overridable per colour on the card)
  fabricGsm: number | null;
  fabricRollWidth: number | null;
  fabricForm: string | null;
  fabricByColor: Record<string, number>; // colourKey -> current stock for this fabric
  imageUrl: string | null;
  colors: { name: string; hex: string | null }[];
  sizeRatio: [string, number][];
  colorRatio: [string, number][];
  bom: {
    material: string;
    color: string | null;
    dimension: string;
    perPieceQty: number | null;
    trimItemId: number | null;
    trimName: string | null;
    trimCurrent: number | null;
  }[];
  // trim master grouped for the swap picker (Change 02)
  trimMaster: { group: string; items: { id: number; name: string; currentStock: number }[] }[];
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
  const [products, fabricStock, trimStock, allTrims] = await Promise.all([
    db.product.findMany({
      include: {
        fabric: { include: { colors: true } },
        colors: { orderBy: { sortOrder: "asc" } },
        boms: { include: { lines: { include: { trimItem: true } } } },
      },
      orderBy: [{ styleNo: "asc" }, { skuCode: "asc" }],
    }),
    getFabricStock(),
    getTrimStock(),
    db.trimItem.findMany({
      select: { id: true, name: true, currentStock: true, category: true, family: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const fabricAvail = new Map(fabricStock.map((s) => [s.id, s.available]));
  const trimById = new Map(trimStock.map((t) => [t.id, t]));

  // Trim master grouped by category (fallback family) — drives the swap picker.
  const groups = new Map<string, { id: number; name: string; currentStock: number }[]>();
  for (const t of allTrims) {
    const g = t.category ?? t.family ?? "OTHER";
    (groups.get(g) ?? groups.set(g, []).get(g)!).push({ id: t.id, name: t.name, currentStock: t.currentStock });
  }
  const trimMaster = [...groups.entries()]
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) => a.group.localeCompare(b.group));

  return products.map((p) => {
    const colors = p.colors.map((c) => ({ name: c.name, hex: c.hex }));
    const colorRatio =
      parseRatio(p.colorRatioJson) ??
      (colors.length > 0
        ? colors.map((c) => [c.name, 1 / colors.length] as [string, number])
        : []);
    const fabricByColor: Record<string, number> = {};
    for (const c of p.fabric?.colors ?? []) fabricByColor[colorKey(c.color)] = c.currentStock;
    const bom = p.boms.flatMap((b) =>
      b.lines.map((l) => {
        const trim = l.trimItem ? trimById.get(l.trimItem.id) : null;
        return {
          material: l.material,
          color: l.color,
          dimension: (l.dimension ?? "FLAT") as string,
          perPieceQty: l.perPieceQty ?? l.qty,
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
      fabricGsm: p.fabric?.gsm ?? null,
      fabricRollWidth: p.fabric?.rollWidth ?? null,
      fabricForm: p.fabric?.form ?? null,
      fabricByColor,
      imageUrl: p.imageUrl,
      colors,
      sizeRatio: parseRatio(p.sizeRatioJson) ?? DEFAULT_SIZE_RATIO,
      colorRatio,
      bom,
      trimMaster,
    };
  });
}

export async function getFabricLedger(fabricId: number) {
  return db.stockMovement.findMany({
    where: { fabricId },
    include: { jobCard: { include: { product: true } } },
    orderBy: { date: "desc" },
    take: 80,
  });
}
