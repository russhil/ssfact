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
  // Change 17: master single-source fields (Part D) + reorder trigger (Part H).
  dimension: string | null; perPieceAvg: number | null; reorderLevel: number | null;
};

export async function getTrimMaster(): Promise<TrimMasterRow[]> {
  const trims = await db.trimItem.findMany({ include: { supplier: true }, orderBy: { name: "asc" } });
  return trims.map((t) => ({
    id: t.id, name: t.name, category: t.category, family: t.family,
    supplier: t.supplier?.name ?? null, ratePerUnit: t.ratePerUnit, unit: t.unit,
    status: t.status, current: t.currentStock, opening: t.openingStock,
    dimension: (t as { dimension?: string | null }).dimension ?? null,
    perPieceAvg: (t as { perPieceAvg?: number | null }).perPieceAvg ?? null,
    reorderLevel: (t as { reorderLevel?: number | null }).reorderLevel ?? null,
  }));
}

function poStageOf(o: { poNumber: string | null; sentAt: Date | null }): "Draft" | "PO Generated" | "Sent" {
  if (o.sentAt) return "Sent";
  if (o.poNumber) return "PO Generated";
  return "Draft";
}

// Change 18 Part C: the inward challans a purchase order was received on. Voided challans
// are excluded — a reversed receipt is not a receipt.
const CHALLAN_LINK = {
  where: { voidedAt: null },
  select: { id: true, challanNo: true, status: true },
  orderBy: { id: "asc" as const },
};
export type OrderChallanLink = { id: number; challanNo: string | null; status: string };
const receivedOnOf = (cs: OrderChallanLink[]) => cs.find((c) => c.status === "LOCKED")?.challanNo ?? null;

export async function getFabricOrders() {
  const orders = await db.fabricOrder.findMany({
    include: { fabric: true, supplier: true, lines: true, challans: CHALLAN_LINK },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  return orders.map((o) => {
    // new orders use lines[]; legacy rows fall back to the single color/qty
    const lines = o.lines.length > 0 ? o.lines.map((l) => ({ colour: l.colour, qty: l.qty })) : o.color ? [{ colour: o.color, qty: o.qty }] : [];
    const totalQty = lines.reduce((a, l) => a + l.qty, 0) || o.qty;
    const challans = o.challans as OrderChallanLink[];
    return {
      id: o.id, fabric: o.fabric.name, fabricId: o.fabricId, supplier: o.supplier?.name ?? null,
      lines, totalQty, colourCount: lines.length, unit: o.unit, rate: o.rate, status: o.status as string,
      expectedDate: o.expectedDate, receivedDate: o.receivedDate,
      poNumber: o.poNumber, poStage: poStageOf(o), sentAt: o.sentAt,
      challans, receivedOn: receivedOnOf(challans),
    };
  });
}

export async function getFabricOrder(id: number) {
  const o = await db.fabricOrder.findUnique({ where: { id }, include: { fabric: true, supplier: true, lines: true, challans: CHALLAN_LINK } });
  if (!o) return null;
  const lines = o.lines.length > 0 ? o.lines.map((l) => ({ colour: l.colour, qty: l.qty })) : o.color ? [{ colour: o.color, qty: o.qty }] : [];
  return {
    id: o.id, fabric: o.fabric.name, gsm: o.gsm, unit: o.unit, rate: o.rate, remarks: o.remarks,
    supplier: o.supplier ? { name: o.supplier.name, address: (o.supplier as { address?: string | null }).address ?? null, phone: o.supplier.phone, email: (o.supplier as { email?: string | null }).email ?? null } : null,
    lines, totalQty: lines.reduce((a, l) => a + l.qty, 0) || o.qty,
    status: o.status as string, expectedDate: o.expectedDate, orderDate: o.orderDate,
    poNumber: o.poNumber, poGeneratedAt: o.poGeneratedAt, sentAt: o.sentAt, poStage: poStageOf(o),
    challans: o.challans as OrderChallanLink[],
  };
}

// ── Change 18 Part B — trim orders (mirror of the fabric pair above) ──

export async function getTrimOrders() {
  const orders = await db.trimOrder.findMany({
    include: { trimItem: true, supplier: true, lines: true, challans: CHALLAN_LINK },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  return orders.map((o) => {
    const challans = o.challans as OrderChallanLink[];
    return {
      id: o.id, trim: o.trimItem.name, trimItemId: o.trimItemId, supplier: o.supplier?.name ?? null,
      lines: o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty })),
      totalQty: o.qty, unit: o.unit ?? o.trimItem.unit ?? null, rate: o.rate, status: o.status as string,
      expectedDate: o.expectedDate, receivedDate: o.receivedDate,
      poNumber: o.poNumber, poStage: poStageOf(o), sentAt: o.sentAt,
      challans, receivedOn: receivedOnOf(challans),
    };
  });
}
export type TrimOrderRow = Awaited<ReturnType<typeof getTrimOrders>>[number];

export async function getTrimOrder(id: number) {
  const o = await db.trimOrder.findUnique({ where: { id }, include: { trimItem: true, supplier: true, lines: true, challans: CHALLAN_LINK } });
  if (!o) return null;
  return {
    id: o.id, trim: o.trimItem.name, unit: o.unit ?? o.trimItem.unit ?? null, rate: o.rate, remarks: o.remarks,
    supplier: o.supplier ? { name: o.supplier.name, address: (o.supplier as { address?: string | null }).address ?? null, phone: o.supplier.phone, email: (o.supplier as { email?: string | null }).email ?? null } : null,
    lines: o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty })),
    totalQty: o.qty,
    status: o.status as string, expectedDate: o.expectedDate, orderDate: o.orderDate,
    poNumber: o.poNumber, poGeneratedAt: o.poGeneratedAt, sentAt: o.sentAt, poStage: poStageOf(o),
    challans: o.challans as OrderChallanLink[],
  };
}

/** Active trims for the trim-order picker (mirrors getFabricPickList). */
export async function getTrimPickList() {
  const rows = await db.trimItem.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, unit: true, currentStock: true, ratePerUnit: true },
    orderBy: { name: "asc" },
  });
  return rows.map((t) => ({ id: t.id, name: t.name, unit: t.unit, stock: t.currentStock, rate: t.ratePerUnit }));
}
export type TrimPick = Awaited<ReturnType<typeof getTrimPickList>>[number];

// ── Change 18 Part E — sourcing quick-view ──
// The master rate is an ESTIMATE. The true rate lives on each PO. This read gives the
// master a read-only "who quoted what" panel without opening every order.

export async function getFabricSourcing(fabricId: number) {
  const [rates, pos] = await Promise.all([
    db.fabricSupplier.findMany({
      where: { fabricId },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: [{ sourcedAt: "desc" }, { id: "asc" }],
    }),
    db.fabricOrder.findMany({
      where: { fabricId },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ poGeneratedAt: "desc" }, { orderDate: "desc" }],
      take: 10,
    }),
  ]);
  return {
    rates: rates.map((r) => ({
      id: r.id,
      supplier: r.supplier?.name ?? r.name, // legacy rows kept their free-text name
      supplierId: r.supplierId,
      rate: r.rate,
      poNumber: r.poNumber,
      sourcedAt: r.sourcedAt,
    })),
    pos: pos.map((o) => ({
      id: o.id,
      poNumber: o.poNumber,
      supplier: o.supplier?.name ?? null,
      rate: o.rate,
      unit: o.unit as string,
      qty: o.qty,
      orderDate: o.orderDate,
      status: o.status as string,
    })),
  };
}

export async function getTrimSourcing(trimItemId: number) {
  const pos = await db.trimOrder.findMany({
    where: { trimItemId },
    include: { supplier: { select: { name: true } }, trimItem: { select: { unit: true } } },
    orderBy: [{ poGeneratedAt: "desc" }, { orderDate: "desc" }],
    take: 10,
  });
  return {
    pos: pos.map((o) => ({
      id: o.id,
      poNumber: o.poNumber,
      supplier: o.supplier?.name ?? null,
      rate: o.rate,
      unit: o.unit ?? o.trimItem.unit ?? "",
      qty: o.qty,
      orderDate: o.orderDate,
      status: o.status as string,
    })),
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

export async function listChallans(filter?: { direction?: "INWARD" | "OUTWARD"; vendorId?: number; supplierId?: number; jobCardId?: number }) {
  const rows = await db.materialChallan.findMany({
    where: {
      ...(filter?.direction ? { direction: filter.direction as any } : {}),
      ...(filter?.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter?.supplierId ? { supplierId: filter.supplierId } : {}),
      ...(filter?.jobCardId ? { jobCardId: filter.jobCardId } : {}),
    },
    include: { supplier: true, vendor: true, lines: true, jobCard: { select: { id: true, siNo: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    direction: c.direction as string,
    status: (c.voidedAt ? "VOID" : c.status) as string,
    // Change 17 Part C: kind (persisted, or derived from lines for legacy rows) + job card.
    kind: ((c as { kind?: string | null }).kind ?? deriveKind(c.lines)) as string | null,
    challanNo: c.challanNo,
    date: c.date,
    counterparty: c.supplier?.name ?? c.vendor?.name ?? "—",
    jobCardId: c.jobCardId,
    jobCardSiNo: c.jobCard?.siNo ?? null,
    note: c.note,
    lineCount: c.lines.length,
    totalQty: c.lines.reduce((a, l) => a + l.qty, 0),
    totalValue: c.lines.some((l) => l.rate != null) ? c.lines.reduce((a, l) => a + l.qty * (l.rate ?? 0), 0) : null,
  }));
}

/** Derive a challan kind from its lines — for legacy rows whose `kind` column is null. */
function deriveKind(lines: { fabricId: number | null; trimItemId: number | null }[]): string | null {
  const hasFabric = lines.some((l) => l.fabricId != null);
  const hasTrim = lines.some((l) => l.trimItemId != null);
  if (hasFabric && hasTrim) return "COMBINED";
  if (hasFabric) return "FABRIC";
  if (hasTrim) return "TRIM";
  return null;
}

/** All challans raised against a job card, tagged by kind (Change 17 Part C). */
export async function getJobCardChallans(jobCardId: number) {
  return listChallans({ jobCardId });
}

export async function getChallan(id: number) {
  const c = await db.materialChallan.findUnique({
    where: { id },
    include: {
      supplier: true,
      vendor: true,
      jobCard: { select: { id: true, siNo: true } },
      // Change 18 Part C: the PO this challan received against ("For PO-2026-007").
      fabricOrder: { select: { id: true, poNumber: true } },
      trimOrder: { select: { id: true, poNumber: true } },
      lines: { include: { fabric: true, trimItem: true }, orderBy: { id: "asc" } },
    },
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
    kind: ((c as { kind?: string | null }).kind ?? deriveKind(c.lines)) as string | null,
    challanNo: c.challanNo,
    date: c.date,
    note: c.note,
    supplierId: c.supplierId,
    vendorId: c.vendorId,
    jobCardId: c.jobCardId,
    jobCardSiNo: c.jobCard?.siNo ?? null,
    poRef: c.fabricOrder
      ? { kind: "FABRIC" as const, id: c.fabricOrder.id, poNumber: c.fabricOrder.poNumber }
      : c.trimOrder
        ? { kind: "TRIM" as const, id: c.trimOrder.id, poNumber: c.trimOrder.poNumber }
        : null,
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

// Change 16 Part C: a vendor's cutting layers (with cut cells + the dispatches booked
// against them) for the layer-by-layer vendor detail page + dispatch log.
export async function getVendorByName(name: string) {
  return db.vendor.findUnique({ where: { name }, select: { id: true, name: true, kind: true } });
}
export async function getVendorLayers(vendorId: number) {
  return db.cuttingLayer.findMany({
    where: { vendorId },
    orderBy: [{ jobCardId: "desc" }, { layerNo: "asc" }],
    include: {
      cells: true,
      cuttingMaster: { select: { name: true } },
      jobCard: { include: { product: true } },
      dispatches: {
        orderBy: { date: "asc" },
        include: { lines: true, layers: { select: { id: true, layerNo: true, label: true } } },
      },
    },
  });
}
export type VendorLayer = Awaited<ReturnType<typeof getVendorLayers>>[number];

export async function getSupplierChallans(supplierId: number) {
  return listChallans({ supplierId });
}

// Change 17 Part I: a single dispatch event for the finished-garment DC-YYYY-NNN print doc.
export async function getDispatchDoc(id: number) {
  const e = await db.dispatchEvent.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { id: "asc" } },
      layers: { select: { layerNo: true, label: true, vendor: { select: { name: true } } } },
      jobCard: { select: { id: true, siNo: true, customItem: true, product: { select: { name: true, skuCode: true } } } },
    },
  });
  if (!e) return null;
  const vendors = [...new Set(e.layers.map((l) => l.vendor?.name).filter((n): n is string => !!n))];
  return {
    id: e.id,
    dispatchNo: e.dispatchNo,
    challan: e.challan, // legacy free-text ref
    date: e.date,
    reason: e.reason as string,
    note: e.note,
    arrangedBy: e.arrangedBy,
    qty: e.qty,
    jobCardId: e.jobCardId,
    siNo: e.jobCard?.siNo ?? null,
    item: e.jobCard?.product?.name ?? e.jobCard?.customItem ?? "—",
    sku: e.jobCard?.product?.skuCode ?? null,
    vendors, // stitching vendors of the layers this dispatch was booked against
    lines: e.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty })),
  };
}
