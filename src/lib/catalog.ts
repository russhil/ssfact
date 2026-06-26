import { db } from "@/lib/db";
import { getTrimStock, type TrimStock } from "@/lib/trims";
import { siSlug } from "@/lib/jobs";
import { wholesale } from "@/lib/catalog-labels";

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
  hasBom: boolean;
  inProduction: boolean;
};

export async function getProducts(): Promise<ProductRow[]> {
  const products = await db.product.findMany({
    include: {
      _count: { select: { boms: true, jobCards: true } },
    },
  });
  return products
    .map((p) => ({
    id: p.id,
    extId: p.extId,
    skuCode: p.skuCode,
    name: p.name,
    headCategory: p.headCategory,
    styleGroup: p.styleGroup,
    mrp: p.mrp,
    wholesale: wholesale(p.mrp, p.customWsRate),
    status: p.status,
    hasBom: p._count.boms > 0,
    inProduction: p._count.jobCards > 0,
  }))
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
};

export async function getProductDetail(skuOrExtId: string): Promise<ProductDetail | null> {
  const product = await db.product.findFirst({
    where: { OR: [{ skuCode: skuOrExtId }, { extId: skuOrExtId }] },
    include: {
      jobCards: { orderBy: { id: "asc" } },
      boms: { include: { lines: { include: { trimItem: true }, orderBy: { id: "asc" } } } },
      productionOrders: { orderBy: { orderNo: "asc" } },
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
          jobs: jobs.map((j) => ({ siNo: j.siNo, slug: siSlug(j.siNo), cutQty: j.cutQty, received: j.dispatchedQty, status: j.status })),
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
  };
}
