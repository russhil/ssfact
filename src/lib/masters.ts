import { db } from "@/lib/db";

export async function getSuppliers() {
  const suppliers = await db.supplier.findMany({
    include: { _count: { select: { trims: true, fabricOrders: true } } },
    orderBy: { name: "asc" },
  });
  return suppliers.map((s) => ({
    id: s.id, name: s.name, type: s.type, city: s.city, phone: s.phone,
    address: (s as { address?: string | null }).address ?? null, email: (s as { email?: string | null }).email ?? null,
    remarks: s.remarks, active: s.active, trims: s._count.trims, orders: s._count.fabricOrders,
  }));
}

export async function getColours() {
  const rows = await db.colour.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return rows.map((c) => ({ id: c.id, name: c.name, hex: c.hex, active: c.active }));
}

export type LookupRow = { id: number; code: string; label: string; hex: string | null; parentId: number | null; sortOrder: number; active: boolean };

/** Active rows for a kind (ordered) — drives the LookupSelect dropdowns. */
export async function listLookups(kind: string): Promise<LookupRow[]> {
  const rows = await db.lookup.findMany({ where: { kind: kind as any, active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  return rows.map((r) => ({ id: r.id, code: r.code, label: r.label, hex: r.hex, parentId: r.parentId, sortOrder: r.sortOrder, active: r.active }));
}

/** All rows of a kind (incl. inactive) — for the Masters hub management list. */
export async function listLookupsAll(kind: string): Promise<LookupRow[]> {
  const rows = await db.lookup.findMany({ where: { kind: kind as any }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  return rows.map((r) => ({ id: r.id, code: r.code, label: r.label, hex: r.hex, parentId: r.parentId, sortOrder: r.sortOrder, active: r.active }));
}

/** Head categories with their sub-categories nested, for the Categories tree tab. */
export async function getCategoryTree() {
  const [heads, subs] = await Promise.all([listLookupsAll("HEAD_CATEGORY"), listLookupsAll("SUB_CATEGORY")]);
  return heads.map((h) => ({ ...h, children: subs.filter((s) => s.parentId === h.id) }));
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

function poStageOf(o: { poNumber: string | null; sentAt: Date | null }): "Draft" | "PO Generated" | "Sent" {
  if (o.sentAt) return "Sent";
  if (o.poNumber) return "PO Generated";
  return "Draft";
}

export async function getFabricOrders() {
  const orders = await db.fabricOrder.findMany({
    include: { fabric: true, supplier: true, lines: true },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  return orders.map((o) => {
    // new orders use lines[]; legacy rows fall back to the single color/qty
    const lines = o.lines.length > 0 ? o.lines.map((l) => ({ colour: l.colour, qty: l.qty })) : o.color ? [{ colour: o.color, qty: o.qty }] : [];
    const totalQty = lines.reduce((a, l) => a + l.qty, 0) || o.qty;
    return {
      id: o.id, fabric: o.fabric.name, fabricId: o.fabricId, supplier: o.supplier?.name ?? null,
      lines, totalQty, colourCount: lines.length, unit: o.unit, rate: o.rate, status: o.status as string,
      expectedDate: o.expectedDate, receivedDate: o.receivedDate,
      poNumber: o.poNumber, poStage: poStageOf(o), sentAt: o.sentAt,
    };
  });
}

export async function getFabricOrder(id: number) {
  const o = await db.fabricOrder.findUnique({ where: { id }, include: { fabric: true, supplier: true, lines: true } });
  if (!o) return null;
  const lines = o.lines.length > 0 ? o.lines.map((l) => ({ colour: l.colour, qty: l.qty })) : o.color ? [{ colour: o.color, qty: o.qty }] : [];
  return {
    id: o.id, fabric: o.fabric.name, gsm: o.gsm, unit: o.unit, rate: o.rate, remarks: o.remarks,
    supplier: o.supplier ? { name: o.supplier.name, address: (o.supplier as { address?: string | null }).address ?? null, phone: o.supplier.phone, email: (o.supplier as { email?: string | null }).email ?? null } : null,
    lines, totalQty: lines.reduce((a, l) => a + l.qty, 0) || o.qty,
    status: o.status as string, expectedDate: o.expectedDate, orderDate: o.orderDate,
    poNumber: o.poNumber, poGeneratedAt: o.poGeneratedAt, sentAt: o.sentAt, poStage: poStageOf(o),
  };
}

export async function getFabricPickList() {
  return db.fabric.findMany({ select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } });
}

export async function getVendorList() {
  const rows = await db.vendor.findMany({ include: { _count: { select: { jobCards: true } } }, orderBy: { name: "asc" } });
  return rows.map((v) => ({ id: v.id, name: v.name, kind: v.kind as string, active: (v as { active?: boolean }).active ?? true, jobs: v._count.jobCards }));
}

export async function getCuttingMasterList() {
  const rows = await db.cuttingMaster.findMany({ include: { _count: { select: { jobCards: true } } }, orderBy: { name: "asc" } });
  return rows.map((c) => ({ id: c.id, name: c.name, active: (c as { active?: boolean }).active ?? true, jobs: c._count.jobCards }));
}
