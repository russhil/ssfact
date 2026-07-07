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
  const rows = await db.fabric.findMany({
    select: { id: true, name: true, unit: true, gsm: true, rollWidth: true, openingStock: true, colors: { select: { currentStock: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((f) => ({
    id: f.id, name: f.name, unit: f.unit, gsm: f.gsm, rollWidth: f.rollWidth,
    // live stock: sum of per-colour stock when tracked, else opening stock
    stock: f.colors.length ? f.colors.reduce((a, c) => a + c.currentStock, 0) : f.openingStock,
  }));
}
export type FabricPick = Awaited<ReturnType<typeof getFabricPickList>>[number];

export async function getVendorList() {
  const rows = await db.vendor.findMany({ include: { _count: { select: { jobCards: true } } }, orderBy: { name: "asc" } });
  return rows.map((v) => ({ id: v.id, name: v.name, kind: v.kind as string, active: (v as { active?: boolean }).active ?? true, jobs: v._count.jobCards }));
}

export async function getCuttingMasterList() {
  const rows = await db.cuttingMaster.findMany({ include: { _count: { select: { jobCards: true } } }, orderBy: { name: "asc" } });
  return rows.map((c) => ({ id: c.id, name: c.name, active: (c as { active?: boolean }).active ?? true, jobs: c._count.jobCards }));
}

// ── Change 11 — Materials Challans (reads) ──

function challanLineView(l: {
  id: number; qty: number; unit: string | null; rate: number | null; colour: string | null; note: string | null;
  fabric: { name: string } | null; trimItem: { name: string; unit: string | null } | null;
}) {
  const isFabric = !!l.fabric;
  return {
    id: l.id,
    kind: isFabric ? ("fabric" as const) : ("trim" as const),
    name: l.fabric?.name ?? l.trimItem?.name ?? "—",
    colour: l.colour,
    qty: l.qty,
    unit: l.unit ?? l.trimItem?.unit ?? (isFabric ? "MTR" : "PCS"),
    rate: l.rate,
    note: l.note,
  };
}

export async function listChallans(filter?: { direction?: "INWARD" | "OUTWARD"; vendorId?: number; supplierId?: number }) {
  const rows = await db.materialChallan.findMany({
    where: {
      ...(filter?.direction ? { direction: filter.direction as any } : {}),
      ...(filter?.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter?.supplierId ? { supplierId: filter.supplierId } : {}),
    },
    include: { supplier: true, vendor: true, lines: true },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    direction: c.direction as string,
    status: (c.voidedAt ? "VOID" : c.status) as string,
    challanNo: c.challanNo,
    date: c.date,
    counterparty: c.supplier?.name ?? c.vendor?.name ?? "—",
    note: c.note,
    lineCount: c.lines.length,
    totalQty: c.lines.reduce((a, l) => a + l.qty, 0),
    totalValue: c.lines.some((l) => l.rate != null) ? c.lines.reduce((a, l) => a + l.qty * (l.rate ?? 0), 0) : null,
  }));
}

export async function getChallan(id: number) {
  const c = await db.materialChallan.findUnique({
    where: { id },
    include: { supplier: true, vendor: true, lines: { include: { fabric: true, trimItem: true }, orderBy: { id: "asc" } } },
  });
  if (!c) return null;
  const lines = c.lines.map(challanLineView);
  const totalValue = lines.some((l) => l.rate != null) ? lines.reduce((a, l) => a + l.qty * (l.rate ?? 0), 0) : null;
  const cp = c.supplier ?? c.vendor;
  return {
    id: c.id,
    direction: c.direction as "INWARD" | "OUTWARD",
    status: (c.voidedAt ? "VOID" : c.status) as string,
    voided: !!c.voidedAt,
    challanNo: c.challanNo,
    date: c.date,
    note: c.note,
    supplierId: c.supplierId,
    vendorId: c.vendorId,
    counterparty: cp
      ? {
          name: cp.name,
          phone: (cp as { phone?: string | null }).phone ?? null,
          address: (cp as { address?: string | null }).address ?? null,
          email: (cp as { email?: string | null }).email ?? null,
        }
      : null,
    lines,
    totalQty: lines.reduce((a, l) => a + l.qty, 0),
    totalValue,
  };
}

export async function getVendorChallans(vendorId: number) {
  return listChallans({ vendorId });
}

export async function getSupplierChallans(supplierId: number) {
  return listChallans({ supplierId });
}
