import { db } from "@/lib/db";

export async function getSuppliers() {
  const suppliers = await db.supplier.findMany({
    include: { _count: { select: { trims: true, fabricOrders: true } } },
    orderBy: { name: "asc" },
  });
  return suppliers.map((s) => ({
    id: s.id, name: s.name, type: s.type, city: s.city, phone: s.phone, remarks: s.remarks,
    active: s.active, trims: s._count.trims, orders: s._count.fabricOrders,
  }));
}

export type TrimMasterRow = {
  id: number; name: string; category: string | null; family: string | null;
  supplier: string | null; ratePerUnit: number | null; unit: string | null;
  status: string; current: number; opening: number;
};

export async function getTrimMaster(): Promise<TrimMasterRow[]> {
  const trims = await db.trimItem.findMany({ include: { supplier: true }, orderBy: { name: "asc" } });
  return trims.map((t) => ({
    id: t.id, name: t.name, category: t.category, family: t.family,
    supplier: t.supplier?.name ?? null, ratePerUnit: t.ratePerUnit, unit: t.unit,
    status: t.status, current: t.currentStock, opening: t.openingStock,
  }));
}

export async function getFabricOrders() {
  const orders = await db.fabricOrder.findMany({
    include: { fabric: true, supplier: true },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  return orders.map((o) => ({
    id: o.id, fabric: o.fabric.name, fabricId: o.fabricId, color: o.color, supplier: o.supplier?.name ?? null,
    qty: o.qty, unit: o.unit, rate: o.rate, status: o.status as string,
    expectedDate: o.expectedDate, receivedDate: o.receivedDate,
  }));
}

export async function getFabricPickList() {
  return db.fabric.findMany({ select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } });
}
