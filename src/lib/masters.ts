import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { POSTED_ORDER, DRAFTS_ONLY } from "@/lib/job-scope";

/** Change 25 Part G.0 — a named person, rendered as `name (role)`. */
export type ContactRow = {
  id: number;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
};

export async function getSuppliers() {
  const suppliers = await db.supplier.findMany({
    include: {
      _count: { select: { trims: true, fabricOrders: true } },
      contacts: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
    orderBy: { name: "asc" },
  });
  return suppliers.map((s) => ({
    id: s.id, name: s.name, type: s.type, city: s.city, phone: s.phone,
    address: (s as { address?: string | null }).address ?? null, email: (s as { email?: string | null }).email ?? null,
    // Change 25 Part G.1
    gstNo: s.gstNo,
    contacts: s.contacts.map((c): ContactRow => ({ id: c.id, name: c.name, role: c.role, phone: c.phone, email: c.email })),
    remarks: s.remarks, active: s.active, trims: s._count.trims, orders: s._count.fabricOrders,
  }));
}

export type SupplierRow = Awaited<ReturnType<typeof getSuppliers>>[number];

/* ── Change 25 Part G.2 — the buyer (issuing firm) master ── */

export type BuyerRow = {
  id: number;
  name: string;
  gstNo: string | null;
  city: string | null;
  buyerAddress: string | null;
  billingAddress: string | null;
  active: boolean;
  contacts: ContactRow[];
  deliveryAddrs: { id: number; label: string | null; address: string; active: boolean }[];
  orders: number;
};

export async function getBuyers(): Promise<BuyerRow[]> {
  const rows = await db.buyer.findMany({
    include: {
      contacts: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      deliveryAddrs: { orderBy: { id: "asc" } },
      _count: { select: { fabricOrders: true, trimOrders: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    gstNo: b.gstNo,
    city: b.city,
    buyerAddress: b.buyerAddress,
    billingAddress: b.billingAddress,
    active: b.active,
    contacts: b.contacts.map((c): ContactRow => ({ id: c.id, name: c.name, role: c.role, phone: c.phone, email: c.email })),
    deliveryAddrs: b.deliveryAddrs.map((a) => ({ id: a.id, label: a.label, address: a.address, active: a.active })),
    orders: b._count.fabricOrders + b._count.trimOrders,
  }));
}

/**
 * The firm picker shown when a PO is generated — active firms with their active
 * delivery addresses only. A deactivated address stays on the orders that already
 * reference it but is never offered again.
 */
export async function getBuyerOptions() {
  const rows = await db.buyer.findMany({
    where: { active: true },
    select: {
      id: true, name: true, gstNo: true,
      deliveryAddrs: { where: { active: true }, select: { id: true, label: true, address: true }, orderBy: { id: "asc" } },
      // Change 38 Part F — the PO's authorised signatory is one of the issuing firm's own
      // people, so the contacts travel with the buyer into the generate dialog.
      contacts: { select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
    orderBy: { name: "asc" },
  });
  return rows;
}

// Change 39 G1 — the names that may sign a challan / job card: our firm's own people, the
// union of every active buyer's contacts, deduped, name only. Unlike a PO (issued by one
// chosen firm), a challan/job card is not buyer-scoped, so all firm contacts are offered.
export async function getFirmContactNames(): Promise<string[]> {
  const buyers = await db.buyer.findMany({
    where: { active: true },
    select: { contacts: { select: { name: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of buyers) {
    for (const c of b.contacts) {
      const n = c.name.trim();
      if (n && !seen.has(n)) { seen.add(n); out.push(n); }
    }
  }
  return out;
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
  // Change 40 Part E — the fields the edit form was missing, so Rate/Supplier and the specs
  // can finally be filled on an existing trim (1,040 were imported without a rate).
  supplierId: number | null;
  size: string | null; material: string | null; weight: string | null; shape: string | null; color: string | null; remarks: string | null;
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
    supplierId: t.supplierId ?? null,
    size: t.size ?? null, material: t.material ?? null, weight: t.weight ?? null, shape: t.shape ?? null, color: t.color ?? null, remarks: t.remarks ?? null,
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
  // Change 22 Part A: line qty comes along so an order row can show received-so-far vs
  // ordered — a short delivery has to be obvious without opening the challan.
  select: { id: true, challanNo: true, status: true, lines: { select: { qty: true } } },
  orderBy: { id: "asc" as const },
};
export type OrderChallanLink = { id: number; challanNo: string | null; status: string; lines: { qty: number }[] };
const receivedOnOf = (cs: OrderChallanLink[]) => cs.find((c) => c.status === "LOCKED")?.challanNo ?? null;
/**
 * Change 22 Part A — what has physically arrived against a purchase order: the summed line
 * qty of its LOCKED (non-voided) inward challans. Drafts are prepared, not delivered, so
 * they don't count. Locking a challan is the only thing that puts goods into stock.
 */
const receivedQtyOf = (cs: OrderChallanLink[]) =>
  Math.round(
    cs.filter((c) => c.status === "LOCKED").reduce((a, c) => a + c.lines.reduce((x, l) => x + l.qty, 0), 0) * 100
  ) / 100;

export async function getFabricOrders() {
  const orders = await db.fabricOrder.findMany({
    // Change 38 Part A: a DRAFT order has not been placed — it is fetched by getDraftOrders.
    where: POSTED_ORDER,
    include: { fabric: true, supplier: true, lines: true, challans: CHALLAN_LINK , images: { select: { id: true, url: true, thumbUrl: true, caption: true }, orderBy: { sortOrder: "asc" as const } } },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  return orders.map((o) => {
    // new orders use lines[]; legacy rows fall back to the single color/qty
    const lines = o.lines.length > 0 ? o.lines.map((l) => ({ colour: l.colour, qty: l.qty })) : o.color ? [{ colour: o.color, qty: o.qty }] : [];
    const totalQty = lines.reduce((a, l) => a + l.qty, 0) || o.qty;
    const challans = o.challans as OrderChallanLink[];
    return {
      id: o.id, fabric: o.fabric.name, fabricId: o.fabricId, supplier: o.supplier?.name ?? null,
      // supplierId + gsm are what the edit form re-hydrates from; resolving the supplier
      // by name in the component would miss suppliers that have since been deactivated.
      supplierId: o.supplierId, gsm: o.gsm,
      // Change 25 Part J: the remark is shown on the row and re-hydrated by the edit form.
      remarks: o.remarks,
      lines, totalQty, colourCount: lines.length, unit: o.unit, rate: o.rate, status: o.status as string,
      expectedDate: o.expectedDate, receivedDate: o.receivedDate,
      voidedAt: o.voidedAt, // Change 40 C3
      poNumber: o.poNumber, poStage: poStageOf(o), sentAt: o.sentAt,
      challans, receivedOn: receivedOnOf(challans), receivedQty: receivedQtyOf(challans),
      // Change 38 Part H — the shade card / sample photos attached to this order.
      images: o.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, caption: i.caption })),
    };
  });
}

/**
 * Change 25 — everything the PO document needs about the two parties, the tax line,
 * the signatory and the attachments. Shared by both PO doc routes so they print the
 * same blocks from the same shape.
 */
const PO_DOC_INCLUDE = {
  supplier: true,
  buyer: { include: { contacts: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } },
  deliveryAddress: true,
  placedBy: { select: { displayName: true, signatureUrl: true } },
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.FabricOrderInclude & Prisma.TrimOrderInclude;

type PoDocSupplier = { name: string; address?: string | null; phone?: string | null; email?: string | null; gstNo?: string | null } | null;
type PoDocBuyer = {
  name: string; gstNo: string | null; city: string | null; buyerAddress: string | null; billingAddress: string | null;
  contacts: { name: string; role: string | null; phone: string | null }[];
} | null;

/** `Ramesh (Owner)` — the convention the owner asked for, blank role = plain name. */
export const contactLabel = (c: { name: string; role?: string | null }) => (c.role ? `${c.name} (${c.role})` : c.name);

// Change 39 G3 — POs raised from this date fall back to the FIRM name (never the login user)
// when no signatory is chosen. Older filed POs keep their existing login-user rendering so a
// document already sent out never changes shape. (Change 38 — signatory picker — merged here.)
const SIGNATORY_FALLBACK_FROM = new Date("2026-08-03T00:00:00Z");

function poParties(o: {
  signatoryName?: string | null;
  createdAt?: Date | null;
  supplier: PoDocSupplier;
  buyer: PoDocBuyer;
  deliveryAddress: { label: string | null; address: string } | null;
  placedBy: { displayName: string; signatureUrl: string | null } | null;
  gstRate: number | null;
  images: { id: number; url: string; thumbUrl: string | null; caption: string | null }[];
}) {
  const firmName = o.buyer?.name ?? "Sport Sun";
  const isNewDoc = o.createdAt != null && o.createdAt >= SIGNATORY_FALLBACK_FROM;
  return {
    supplier: o.supplier
      ? {
          name: o.supplier.name,
          address: o.supplier.address ?? null,
          phone: o.supplier.phone ?? null,
          email: o.supplier.email ?? null,
          gstNo: o.supplier.gstNo ?? null,
        }
      : null,
    buyer: o.buyer
      ? {
          name: o.buyer.name,
          gstNo: o.buyer.gstNo,
          city: o.buyer.city,
          address: o.buyer.buyerAddress,
          billingAddress: o.buyer.billingAddress,
          contacts: o.buyer.contacts.map((c) => ({ label: contactLabel(c), phone: c.phone })),
        }
      : null,
    shipTo: o.deliveryAddress ? { label: o.deliveryAddress.label, address: o.deliveryAddress.address } : null,
    // Change 38 Part F — the signatory is a contact of the issuing firm, printed as a name
    // and nothing else. POs issued before this still print their login-user signatory (and
    // its signature graphic) so an already-filed document never changes shape.
    signatory: o.signatoryName
      ? { name: o.signatoryName, signatureUrl: null }
      // Change 39 G3 — a NEW PO with no chosen signatory prints the firm name, not the login
      // user's name + signature graphic. Legacy POs keep the login-user rendering.
      : isNewDoc
        ? { name: firmName, signatureUrl: null }
        : o.placedBy
          ? { name: o.placedBy.displayName, signatureUrl: o.placedBy.signatureUrl }
          : { name: firmName, signatureUrl: null },
    // Change 39 G2 — the staff who raised it, shown as "Prepared by" (display only).
    preparedBy: o.placedBy ? { name: o.placedBy.displayName, at: o.createdAt ?? null } : null,
    gstRate: o.gstRate,
    images: o.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, caption: i.caption })),
  };
}

export async function getFabricOrder(id: number) {
  const o = await db.fabricOrder.findUnique({
    where: { id },
    include: { fabric: true, lines: true, challans: CHALLAN_LINK, ...PO_DOC_INCLUDE },
  });
  if (!o) return null;
  const lines = o.lines.length > 0 ? o.lines.map((l) => ({ colour: l.colour, qty: l.qty })) : o.color ? [{ colour: o.color, qty: o.qty }] : [];
  return {
    id: o.id, fabric: o.fabric.name, gsm: o.gsm, unit: o.unit, rate: o.rate, remarks: o.remarks,
    lines, totalQty: lines.reduce((a, l) => a + l.qty, 0) || o.qty,
    status: o.status as string, expectedDate: o.expectedDate, orderDate: o.orderDate,
    poNumber: o.poNumber, poGeneratedAt: o.poGeneratedAt, sentAt: o.sentAt, poStage: poStageOf(o),
    challans: o.challans as OrderChallanLink[],
    ...poParties(o),
  };
}

// ── Change 18 Part B — trim orders (mirror of the fabric pair above) ──

export async function getTrimOrders() {
  const orders = await db.trimOrder.findMany({
    // Change 38 Part A: see getFabricOrders.
    where: POSTED_ORDER,
    include: { trimItem: true, supplier: true, lines: true, challans: CHALLAN_LINK , images: { select: { id: true, url: true, thumbUrl: true, caption: true }, orderBy: { sortOrder: "asc" as const } } },
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
  });
  return orders.map((o) => {
    const challans = o.challans as OrderChallanLink[];
    return {
      id: o.id, trim: o.trimItem.name, trimItemId: o.trimItemId, supplier: o.supplier?.name ?? null,
      supplierId: o.supplierId, remarks: o.remarks, // re-hydrated by the edit form
      lines: o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty })),
      totalQty: o.qty, unit: o.unit ?? o.trimItem.unit ?? null, rate: o.rate, status: o.status as string,
      expectedDate: o.expectedDate, receivedDate: o.receivedDate,
      voidedAt: o.voidedAt, // Change 40 C3 — struck-through in the list when voided
      poNumber: o.poNumber, poStage: poStageOf(o), sentAt: o.sentAt,
      challans, receivedOn: receivedOnOf(challans), receivedQty: receivedQtyOf(challans),
      // Change 38 Part H — the shade card / sample photos attached to this order.
      images: o.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, caption: i.caption })),
    };
  });
}
export type TrimOrderRow = Awaited<ReturnType<typeof getTrimOrders>>[number];

export async function getTrimOrder(id: number) {
  const o = await db.trimOrder.findUnique({
    where: { id },
    include: { trimItem: true, lines: true, challans: CHALLAN_LINK, ...PO_DOC_INCLUDE },
  });
  if (!o) return null;
  return {
    id: o.id, trim: o.trimItem.name, unit: o.unit ?? o.trimItem.unit ?? null, rate: o.rate, remarks: o.remarks,
    lines: o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty })),
    totalQty: o.qty,
    status: o.status as string, expectedDate: o.expectedDate, orderDate: o.orderDate,
    poNumber: o.poNumber, poGeneratedAt: o.poGeneratedAt, sentAt: o.sentAt, poStage: poStageOf(o),
    challans: o.challans as OrderChallanLink[],
    ...poParties(o),
  };
}

/** Active trims for the trim-order picker (mirrors getFabricPickList). */
export async function getTrimPickList() {
  const rows = await db.trimItem.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, unit: true, currentStock: true, ratePerUnit: true, supplierId: true },
    orderBy: { name: "asc" },
  });
  // Change 40 Part F — supplierId rides along so picking a trim on an order prefills its supplier.
  return rows.map((t) => ({ id: t.id, name: t.name, unit: t.unit, stock: t.currentStock, rate: t.ratePerUnit, supplierId: t.supplierId ?? null }));
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

// ── Change 20 — logins ──

export type UserRow = {
  id: number; username: string; displayName: string;
  role: "ADMIN" | "STAFF" | "VENDOR" | "TRIMS";
  vendorName: string | null; active: boolean; createdAt: Date;
  /** Change 25 Part I — printed above the name on every PO this person raises. */
  signatureUrl: string | null;
};

/**
 * Every login, for the admin Users page. The `select` is explicit and deliberate:
 * it makes serialising `passwordHash` into a client component structurally
 * impossible rather than merely conventional.
 */
export async function listUsers(): Promise<UserRow[]> {
  const rows = await db.user.findMany({
    select: {
      id: true, username: true, displayName: true, role: true,
      vendorName: true, active: true, createdAt: true, signatureUrl: true,
    },
    orderBy: [{ active: "desc" }, { role: "asc" }, { username: "asc" }],
  });
  return rows.map((u) => ({ ...u, role: u.role as UserRow["role"] }));
}

// ── Change 25 Part A — the audit log (read side) ──

export type AuditRow = {
  id: string;
  at: Date;
  userId: number | null;
  username: string;
  action: string;
  entity: string;
  entityId: string;
  entityLabel: string | null;
  summary: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  meta: Record<string, unknown> | null;
};

const AUDIT_WINDOW_DAYS = 90;
const AUDIT_MAX_ROWS = 1000;

/**
 * The recent audit window. Bounded because the /audit page filters client-side over
 * rows the server already fetched (the Change 23 toolbar idiom) — an unbounded log
 * would ship the whole table to the browser.
 *
 * `changes` / `meta` are stored as JSON text; a row whose JSON is unparseable comes
 * back null rather than taking the page down.
 */
export async function getAuditLog(): Promise<AuditRow[]> {
  const since = new Date(Date.now() - AUDIT_WINDOW_DAYS * 86_400_000);
  const rows = await db.auditLog.findMany({
    where: { at: { gte: since } },
    orderBy: { at: "desc" },
    take: AUDIT_MAX_ROWS,
  });
  const parse = <T,>(s: string | null): T | null => {
    if (!s) return null;
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    userId: r.userId,
    username: r.username,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    entityLabel: r.entityLabel,
    summary: r.summary,
    changes: parse<Record<string, { old: unknown; new: unknown }>>(r.changes),
    meta: parse<Record<string, unknown>>(r.meta),
  }));
}

/**
 * Dropdown options for the /audit filters, derived from the WHOLE table rather than
 * the fetched window — the same choice azadi makes, so the options don't collapse as
 * you narrow the view.
 */
export async function getAuditFilterOptions() {
  const [actions, entities, users] = await Promise.all([
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.auditLog.findMany({ distinct: ["username"], select: { username: true }, orderBy: { username: "asc" } }),
  ]);
  return {
    actions: actions.map((a) => a.action),
    entities: entities.map((e) => e.entity),
    users: users.map((u) => u.username),
  };
}

export async function getCuttingMasterList() {
  const rows = await db.cuttingMaster.findMany({ include: { _count: { select: { jobCards: true } } }, orderBy: { name: "asc" } });
  return rows.map((c) => ({ id: c.id, name: c.name, active: (c as { active?: boolean }).active ?? true, jobs: c._count.jobCards }));
}

// ── Change 11 — Materials Challans (reads) ──

function challanLineView(l: {
  id: number; qty: number; unit: string | null; rate: number | null; colour: string | null; note: string | null;
  size?: string | null; cuttingLayerId?: number | null;
  fabric: { name: string } | null; trimItem: { name: string; unit: string | null } | null;
}) {
  const isFabric = !!l.fabric;
  // Change 39 Part D2 — a cut-goods line carries a cuttingLayerId + size and no fabric/trim;
  // it prints as pieces in the cutting grid and posts no store movement.
  const isCut = l.cuttingLayerId != null && !l.fabric && !l.trimItem;
  return {
    id: l.id,
    kind: isFabric ? ("fabric" as const) : ("trim" as const),
    isCut,
    cuttingLayerId: l.cuttingLayerId ?? null,
    size: l.size ?? null,
    name: l.fabric?.name ?? l.trimItem?.name ?? (isCut ? "Cut goods" : "—"),
    colour: l.colour,
    qty: l.qty,
    unit: l.unit ?? l.trimItem?.unit ?? (isFabric ? "MTR" : isCut ? "PCS" : "PCS"),
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
      // Change 25 Part D: both ends of a purchase return — the inward challan this
      // one sends back, and any returns already raised against this one.
      returnOf: { select: { id: true, challanNo: true } },
      returns: { select: { id: true, challanNo: true, status: true, voidedAt: true, returnReason: true } },
      lines: { include: { fabric: true, trimItem: true }, orderBy: { id: "asc" } },
      // Change 25 Part H.3: the proof photo of the paper challan / received bundle.
      images: { orderBy: { sortOrder: "asc" } },
      // Change 39 G2 — the staff who prepared it (shown as "Prepared by").
      createdBy: { select: { displayName: true } },
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
    // Change 25 Part D
    returnOf: c.returnOf ? { id: c.returnOf.id, challanNo: c.returnOf.challanNo } : null,
    returnReason: c.returnReason,
    returns: c.returns.map((r) => ({
      id: r.id,
      challanNo: r.challanNo,
      status: (r.voidedAt ? "VOID" : r.status) as string,
      reason: r.returnReason,
    })),
    // Change 25 Part D: a purchase return is OUTWARD but goes to a supplier, so the
    // document's "To" label can no longer be inferred from direction alone.
    counterpartyKind: c.supplier ? ("SUPPLIER" as const) : c.vendor ? ("VENDOR" as const) : null,
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
    // Change 39 G1/G2 — authorised signatory (firm contact name; firm-name fallback in the
    // doc, never the login user) + who prepared it.
    signatoryName: c.signatoryName ?? null,
    preparedBy: c.createdBy ? { name: c.createdBy.displayName, at: c.createdAt } : null,
    // Change 25 Part H.3
    images: c.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl, caption: i.caption })),
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
      // Change 22 B.1: the vendor log and the layer balances ignore voided dispatches.
      dispatches: {
        where: { voidedAt: null },
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


/**
 * Change 38 Part A — purchase orders someone started and has not placed.
 *
 * A DRAFT order has pushed nothing outward: no unit onto the fabric master, no sourcing rate
 * against a supplier it may never be sent to, and obviously no goods. Resuming one loads it
 * back into the same form via the existing edit path.
 */
export async function getDraftOrders() {
  const [fabric, trim] = await Promise.all([
    db.fabricOrder.findMany({
      where: DRAFTS_ONLY,
      select: { id: true, fabric: { select: { name: true } }, supplier: { select: { name: true } }, qty: true },
      orderBy: { id: "desc" },
    }),
    db.trimOrder.findMany({
      where: DRAFTS_ONLY,
      select: { id: true, trimItem: { select: { name: true } }, supplier: { select: { name: true } }, qty: true },
      orderBy: { id: "desc" },
    }),
  ]);
  return {
    fabric: fabric.map((o) => ({ id: o.id, name: o.fabric?.name ?? "—", supplier: o.supplier?.name ?? null, qty: o.qty })),
    trim: trim.map((o) => ({ id: o.id, name: o.trimItem?.name ?? "—", supplier: o.supplier?.name ?? null, qty: o.qty })),
  };
}

/**
 * Change 40 Part H3 — the open purchase orders for one supplier, for the inward-challan PO
 * picker. Supplier-filtered so the list is a handful, not hundreds. The LABEL is the feature:
 * a store person who did not raise the PO must be able to match the goods in front of him to a
 * line on screen without asking anyone — PO number, item name (first + "+n more" for a
 * multi-trim PO), total qty + unit, expected date, and a partly-received chip. Drafts are
 * included (owner confirmed), labelled "Draft #id". Fully-received, voided and discarded are
 * excluded; pass includeAll to show everything.
 */
export type OpenOrderOption = {
  id: number;
  kind: "fabric" | "trim";
  poNumber: string | null;
  itemName: string;
  qty: number;
  unit: string;
  expectedDate: Date | null;
  isDraft: boolean;
  partlyReceived: boolean;
  label: string;
};

export async function getOpenOrdersForSupplier(
  supplierId: number,
  kind: "fabric" | "trim" | "both" = "both",
  includeAll = false,
): Promise<OpenOrderOption[]> {
  const openStatus = includeAll ? {} : { status: { notIn: ["RECEIVED", "DISCARDED"] as any } };
  const base = { supplierId, voidedAt: null, ...openStatus };
  const out: OpenOrderOption[] = [];

  if (kind === "fabric" || kind === "both") {
    const rows = await db.fabricOrder.findMany({
      where: base,
      select: {
        id: true, poNumber: true, qty: true, unit: true, expectedDate: true, status: true,
        fabric: { select: { name: true } },
        challans: { where: { status: "LOCKED", voidedAt: null }, select: { id: true } },
      },
      orderBy: { id: "desc" },
    });
    for (const o of rows) {
      const isDraft = o.status === "DRAFT";
      const itemName = o.fabric?.name ?? "—";
      out.push({
        id: o.id, kind: "fabric", poNumber: o.poNumber, itemName, qty: o.qty, unit: String(o.unit),
        expectedDate: o.expectedDate, isDraft, partlyReceived: o.challans.length > 0,
        label: orderLabel(o.poNumber, isDraft, o.id, itemName, o.qty, String(o.unit), o.expectedDate),
      });
    }
  }

  if (kind === "trim" || kind === "both") {
    const rows = await db.trimOrder.findMany({
      where: base,
      select: {
        id: true, poNumber: true, qty: true, unit: true, expectedDate: true, status: true,
        trimItem: { select: { name: true } },
        lines: { select: { trimItemId: true } },
        challans: { where: { status: "LOCKED", voidedAt: null }, select: { id: true } },
      },
      orderBy: { id: "desc" },
    });
    for (const o of rows) {
      const isDraft = o.status === "DRAFT";
      // multi-trim PO (Part G): first item + "+n more" for the extra distinct SKUs
      const distinct = new Set(o.lines.map((l) => l.trimItemId).filter((x): x is number => x != null));
      const extra = Math.max(0, distinct.size - 1);
      const itemName = (o.trimItem?.name ?? "—") + (extra > 0 ? ` +${extra} more` : "");
      out.push({
        id: o.id, kind: "trim", poNumber: o.poNumber, itemName, qty: o.qty, unit: o.unit ?? "pcs",
        expectedDate: o.expectedDate, isDraft, partlyReceived: o.challans.length > 0,
        label: orderLabel(o.poNumber, isDraft, o.id, itemName, o.qty, o.unit ?? "pcs", o.expectedDate),
      });
    }
  }

  return out;
}

function orderLabel(
  poNumber: string | null, isDraft: boolean, id: number, itemName: string,
  qty: number, unit: string, expectedDate: Date | null,
): string {
  const handle = poNumber ?? (isDraft ? `Draft #${id}` : `#${id}`);
  const q = `${qty.toLocaleString("en-IN")} ${unit}`;
  const exp = expectedDate ? ` · exp ${expectedDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "";
  const draft = isDraft ? " [DRAFT]" : "";
  return `${handle} · ${itemName} · ${q}${exp}${draft}`;
}

/**
 * Change 40 Part H8.2 — the "Pending POs" list the owner asked for by name: every order placed
 * and not fully received. Received qty comes from LOCKED challans linked to the order — never
 * from the order's own fields. Excludes drafts, voided and fully-received. Balance/overdue are
 * derived, never stored.
 */
export type PendingPO = {
  id: number; kind: "fabric" | "trim"; poNumber: string | null; supplier: string; item: string;
  ordered: number; unit: string; received: number; balance: number; expectedDate: Date | null; daysOverdue: number;
};

function daysOverdueOf(expected: Date | null, now: Date): number {
  if (!expected) return 0;
  const d = Math.floor((now.getTime() - new Date(expected).getTime()) / 86_400_000);
  return d > 0 ? d : 0;
}

export async function getPendingPOs(now = new Date()): Promise<PendingPO[]> {
  const notReceived = { poNumber: { not: null }, voidedAt: null, status: { notIn: ["RECEIVED", "DISCARDED", "DRAFT"] as any } };
  const lockedLines = { challans: { where: { status: "LOCKED" as const, voidedAt: null }, select: { lines: { select: { qty: true } } } } };
  const [fabric, trim] = await Promise.all([
    db.fabricOrder.findMany({
      where: notReceived,
      select: { id: true, poNumber: true, qty: true, unit: true, expectedDate: true, supplier: { select: { name: true } }, fabric: { select: { name: true } }, ...lockedLines },
      orderBy: { expectedDate: "asc" },
    }),
    db.trimOrder.findMany({
      where: notReceived,
      select: { id: true, poNumber: true, qty: true, unit: true, expectedDate: true, supplier: { select: { name: true } }, trimItem: { select: { name: true } }, ...lockedLines },
      orderBy: { expectedDate: "asc" },
    }),
  ]);
  const recvOf = (o: { challans: { lines: { qty: number }[] }[] }) => o.challans.reduce((a, c) => a + c.lines.reduce((b, l) => b + l.qty, 0), 0);
  const rows: PendingPO[] = [];
  for (const o of fabric) {
    const received = recvOf(o);
    rows.push({ id: o.id, kind: "fabric", poNumber: o.poNumber, supplier: o.supplier?.name ?? "—", item: o.fabric?.name ?? "—", ordered: o.qty, unit: String(o.unit), received, balance: o.qty - received, expectedDate: o.expectedDate, daysOverdue: daysOverdueOf(o.expectedDate, now) });
  }
  for (const o of trim) {
    const received = recvOf(o);
    rows.push({ id: o.id, kind: "trim", poNumber: o.poNumber, supplier: o.supplier?.name ?? "—", item: o.trimItem?.name ?? "—", ordered: o.qty, unit: o.unit ?? "pcs", received, balance: o.qty - received, expectedDate: o.expectedDate, daysOverdue: daysOverdueOf(o.expectedDate, now) });
  }
  return rows;
}

/**
 * Change 40 Part H8.1 — challans that arrived with no PO (poPending) and are still unlinked.
 * Without this list they are forgotten and their stock is untraceable to a purchase.
 */
export type PoPendingChallan = { id: number; challanNo: string | null; status: string; date: Date; supplier: string; supplierId: number | null; qty: number; kind: string | null };

export async function getPoPendingChallans(): Promise<PoPendingChallan[]> {
  const rows = await db.materialChallan.findMany({
    where: { poPending: true, fabricOrderId: null, trimOrderId: null, voidedAt: null },
    select: { id: true, challanNo: true, status: true, date: true, kind: true, supplierId: true, supplier: { select: { name: true } }, lines: { select: { qty: true } } },
    orderBy: { date: "desc" },
  });
  return rows.map((c) => ({ id: c.id, challanNo: c.challanNo, status: c.status, date: c.date, supplier: c.supplier?.name ?? "—", supplierId: c.supplierId, qty: c.lines.reduce((a, l) => a + l.qty, 0), kind: c.kind }));
}

/**
 * Change 40 Part H2.3 — the "Inward today" strip. THE reason the rolls field exists: the owner
 * checks the day's physical roll count against the paper. Totals today's LOCKED inward challans.
 */
export type InwardToday = { challans: number; totalRolls: number; totalQty: number; byFabric: { name: string; rolls: number; qty: number }[] };

export async function getInwardToday(now = new Date()): Promise<InwardToday> {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const challans = await db.materialChallan.findMany({
    where: { direction: "INWARD", status: "LOCKED", voidedAt: null, lockedAt: { gte: start } },
    select: { id: true, lines: { select: { qty: true, rolls: true, fabric: { select: { name: true } } } } },
  });
  const byFabric = new Map<string, { rolls: number; qty: number }>();
  let totalRolls = 0, totalQty = 0;
  for (const c of challans) {
    for (const l of c.lines) {
      totalQty += l.qty; totalRolls += l.rolls ?? 0;
      if (l.fabric) { const cur = byFabric.get(l.fabric.name) ?? { rolls: 0, qty: 0 }; byFabric.set(l.fabric.name, { rolls: cur.rolls + (l.rolls ?? 0), qty: cur.qty + l.qty }); }
    }
  }
  return { challans: challans.length, totalRolls, totalQty, byFabric: [...byFabric.entries()].map(([name, v]) => ({ name, ...v })) };
}
