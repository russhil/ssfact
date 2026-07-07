import { db } from "@/lib/db";
import { getTrimStock, type TrimStock } from "@/lib/trims";
import { wholesale } from "@/lib/catalog-labels";
import { STAGE_LABEL, normStage } from "@/lib/job-labels";

export { wholesale, STATUS_LABEL, statusTone } from "@/lib/catalog-labels";

export type ProductRow = {
  id: number;
  extId: string;
  skuCode: string;
  name: string;
  headCategory: string | null;
  styleGroup: string | null;
  mrp: number | null;
  wholesale: number | null;
  status: string;
  samplingStatus: string | null;
  productionLot: string | null;
  fabricName: string | null;
  imageUrl: string | null;
  hasBom: boolean;
  inProduction: boolean;
  whereInProduction: string | null; // derived from open job cards
};

export async function getProducts(): Promise<ProductRow[]> {
  const products = await db.product.findMany({
    include: {
      fabric: { select: { name: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { thumbUrl: true, url: true } },
      jobCards: { where: { status: "ACTIVE" }, orderBy: { id: "desc" }, take: 1, select: { stage: true, dispatchedQty: true, cutQty: true } },
      _count: { select: { boms: true, jobCards: true } },
    },
  });
  return products
    .map((p) => {
      const open = p.jobCards[0];
      const where = open
        ? `${STAGE_LABEL[normStage(open.stage)]}${open.cutQty ? ` · ${Math.round((open.dispatchedQty / open.cutQty) * 100)}% recd` : ""}`
        : p._count.jobCards > 0
          ? "All closed"
          : null;
      return {
        id: p.id,
        extId: p.extId,
        skuCode: p.skuCode,
        name: p.name,
        headCategory: p.headCategory,
        styleGroup: p.styleGroup,
        mrp: p.mrp,
        wholesale: wholesale(p.mrp, p.customWsRate),
        status: p.status,
        samplingStatus: p.samplingStatus,
        productionLot: p.productionLot,
        fabricName: p.fabric?.name ?? null,
        imageUrl: p.images[0]?.thumbUrl ?? p.images[0]?.url ?? p.imageUrl ?? null,
        hasBom: p._count.boms > 0,
        inProduction: p._count.jobCards > 0,
        whereInProduction: where,
      };
    })
    .sort((a, b) => (a.headCategory ?? "~~").localeCompare(b.headCategory ?? "~~") || a.name.localeCompare(b.name));
}

export type CatalogSummary = {
  total: number;
  active: number;
  withBom: number;
  inProduction: number;
  categories: number;
  byCategory: { name: string; count: number }[];
};

export async function getCatalogSummary(): Promise<CatalogSummary> {
  const rows = await getProducts();
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.headCategory ?? "Uncategorised", (byCat.get(r.headCategory ?? "Uncategorised") ?? 0) + 1);
  return {
    total: rows.length,
    active: rows.filter((r) => r.status === "ACTIVE").length,
    withBom: rows.filter((r) => r.hasBom).length,
    inProduction: rows.filter((r) => r.inProduction).length,
    categories: byCat.size,
    byCategory: [...byCat.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

export type BomLineView = {
  id: number;
  sNo: number | null;
  material: string;
  color: string | null;
  qty: number | null;
  avg: string | null;
  trim: { id: number; name: string; current: number; status: TrimStock["status"] } | null;
};

export type ProductDetail = {
  id: number;
  extId: string;
  skuCode: string;
  name: string;
  headCategory: string | null;
  styleGroup: string | null;
  styleNo: string | null;
  mrp: number | null;
  wholesale: number | null;
  status: string;
  production: {
    styleNo: string;
    jobCount: number;
    cut: number;
    received: number;
    openJobs: number;
    jobs: { siNo: string; slug: string; cutQty: number; received: number; status: string }[];
  } | null;
  boms: { id: number; code: string; styleName: string; matched: number; total: number; lines: BomLineView[] }[];
  orders: { orderNo: string; targetQty: number; avgMonthlySale: number | null; status: string; urgency: string | null; orderDate: Date | null }[];
  // Change 07 production/sampling attributes + gallery
  samplingStatus: string | null;
  productionLot: string | null;
  fabricName: string | null;
  fabricRemarks: string | null;
  otherRemarks: string | null;
  avgConsumption: number | null;
  unit: string;
  customWsRate: number | null;
  colors: { id: number; name: string; hex: string | null }[];
  images: { id: number; url: string; thumbUrl: string | null; caption: string | null }[];
  fabricOrders: { id: number; color: string | null; qty: number; status: string }[];
};

export async function getProductDetail(skuOrExtId: string): Promise<ProductDetail | null> {
  const product = await db.product.findFirst({
    where: { OR: [{ skuCode: skuOrExtId }, { extId: skuOrExtId }] },
    include: {
      jobCards: { orderBy: { id: "asc" } },
      boms: { include: { lines: { include: { trimItem: true }, orderBy: { id: "asc" } } } },
      productionOrders: { orderBy: { orderNo: "asc" } },
      fabric: { include: { fabricOrders: true } },
      colors: { orderBy: { sortOrder: "asc" } },
      images: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!product) return null;

  const stock = await getTrimStock();
  const tmap = new Map(stock.map((t) => [t.id, t]));

  const jobs = product.jobCards;
  const production =
    jobs.length > 0
      ? {
          styleNo: product.styleNo ?? product.skuCode,
          jobCount: jobs.length,
          cut: jobs.reduce((a, j) => a + j.cutQty, 0),
          received: jobs.reduce((a, j) => a + j.dispatchedQty, 0),
          openJobs: jobs.filter((j) => j.status === "ACTIVE").length,
          jobs: jobs.map((j) => ({ siNo: j.siNo, slug: String(j.id), cutQty: j.cutQty, received: j.dispatchedQty, status: j.status })),
        }
      : null;

  const boms = product.boms.map((b) => ({
    id: b.id,
    code: b.code,
    styleName: b.styleName,
    matched: b.lines.filter((l) => l.trimItemId).length,
    total: b.lines.length,
    lines: b.lines.map((l) => {
      const t = l.trimItem ? tmap.get(l.trimItem.id) : null;
      return {
        id: l.id,
        sNo: l.sNo,
        material: l.material,
        color: l.color,
        qty: l.qty,
        avg: l.avg,
        trim: l.trimItem
          ? { id: l.trimItem.id, name: l.trimItem.name, current: t?.current ?? l.trimItem.currentStock, status: t?.status ?? "ok" }
          : null,
      };
    }),
  }));

  return {
    id: product.id,
    extId: product.extId,
    skuCode: product.skuCode,
    name: product.name,
    headCategory: product.headCategory,
    styleGroup: product.styleGroup,
    styleNo: product.styleNo,
    mrp: product.mrp,
    wholesale: wholesale(product.mrp, product.customWsRate),
    status: product.status,
    production,
    boms,
    orders: product.productionOrders.map((o) => ({
      orderNo: o.orderNo,
      targetQty: o.targetQty,
      avgMonthlySale: o.avgMonthlySale,
      status: o.status,
      urgency: o.urgency,
      orderDate: o.orderDate,
    })),
    samplingStatus: product.samplingStatus,
    productionLot: product.productionLot,
    fabricName: product.fabric?.name ?? null,
    fabricRemarks: product.fabricRemarks,
    otherRemarks: product.otherRemarks,
    avgConsumption: product.avgConsumption,
    unit: product.unit,
    customWsRate: product.customWsRate,
    colors: product.colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    images: product.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, caption: i.caption })),
    fabricOrders: (product.fabric?.fabricOrders ?? []).map((o) => ({ id: o.id, color: o.color, qty: o.qty, status: o.status as string })),
  };
}
