import { db } from "@/lib/db";

export const PO_STATUS_LABEL: Record<string, string> = {
  ORDER_GIVEN: "Order Given",
  IN_PRODUCTION: "In Production",
  COMPLETED: "Completed",
};

export const poStatusTone = (s: string): "primary" | "warn" | "ok" | "default" =>
  s === "IN_PRODUCTION" ? "warn" : s === "ORDER_GIVEN" ? "primary" : s === "COMPLETED" ? "ok" : "default";

// Demo fallback monthly sale by head category (mirrors the importer); used to
// suggest a target qty when a product has no prior order to read it from.
const CATEGORY_SALE: Record<string, number> = {
  Polo: 900,
  Roundneck: 1500,
  Trackpant: 900,
  TRACKSUIT: 420,
  Shorts: 700,
  Women: 500,
  Kids: 600,
  "Vest / Cut Sleeves": 800,
  "SPORTS KITS": 300,
  Accessories: 1200,
};

export type OrderRow = {
  id: number;
  orderNo: string;
  productName: string;
  skuCode: string;
  productExtId: string;
  targetQty: number;
  avgMonthlySale: number | null;
  status: string;
  urgency: string | null;
  orderDate: Date | null;
};

export async function getProductionOrders(): Promise<OrderRow[]> {
  const orders = await db.productionOrder.findMany({ include: { product: true }, orderBy: { orderNo: "asc" } });
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    productName: o.product.name,
    skuCode: o.product.skuCode,
    productExtId: o.product.extId,
    targetQty: o.targetQty,
    avgMonthlySale: o.avgMonthlySale,
    status: o.status,
    urgency: o.urgency,
    orderDate: o.orderDate,
  }));
}

export type ProductionSummary = {
  total: number;
  orderGiven: number;
  inProduction: number;
  completed: number;
  targetUnits: number;
};

export async function getProductionSummary(): Promise<ProductionSummary> {
  const orders = await db.productionOrder.findMany();
  return {
    total: orders.length,
    orderGiven: orders.filter((o) => o.status === "ORDER_GIVEN").length,
    inProduction: orders.filter((o) => o.status === "IN_PRODUCTION").length,
    completed: orders.filter((o) => o.status === "COMPLETED").length,
    targetUnits: orders.reduce((a, o) => a + o.targetQty, 0),
  };
}

export async function hasActiveOrder(productId: number): Promise<boolean> {
  const n = await db.productionOrder.count({
    where: { productId, status: { in: ["ORDER_GIVEN", "IN_PRODUCTION"] } },
  });
  return n > 0;
}

export type ProductOption = {
  id: number;
  skuCode: string;
  name: string;
  headCategory: string | null;
  status: string;
  suggestedSale: number;
  hasActiveOrder: boolean;
  activeOrderNo: string | null;
};

/** Catalog products for the new-order form, with a suggested monthly sale + duplicate flag. */
export async function getProductOptions(): Promise<ProductOption[]> {
  const products = await db.product.findMany({
    include: { productionOrders: { where: { status: { in: ["ORDER_GIVEN", "IN_PRODUCTION"] } } } },
    orderBy: { name: "asc" },
  });
  return products.map((p) => ({
    id: p.id,
    skuCode: p.skuCode,
    name: p.name,
    headCategory: p.headCategory,
    status: p.status,
    suggestedSale: p.productionOrders[0]?.avgMonthlySale ?? CATEGORY_SALE[p.headCategory ?? ""] ?? 600,
    hasActiveOrder: p.productionOrders.length > 0,
    activeOrderNo: p.productionOrders[0]?.orderNo ?? null,
  }));
}
