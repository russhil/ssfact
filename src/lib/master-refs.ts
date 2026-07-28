import { db } from "@/lib/db";
import { colorKey } from "@/lib/colour";

/**
 * Change 36 Part 0 — "where is this master actually used?"
 *
 * Masters have never been deletable. The reason it is not a one-liner: almost every
 * FK pointing at a master is OPTIONAL, and Prisma's default for an optional relation
 * is SetNull — so `db.supplier.delete()` on a referenced supplier SUCCEEDS and quietly
 * blanks that supplier off historical POs and challans. Required FKs (JobCard.vendorId,
 * TrimOrder.trimItemId) throw P2003 instead. Neither behaviour is acceptable, and
 * neither is discoverable from a try/catch, so every blocker is counted EXPLICITLY here
 * and the delete actions refuse before touching the row.
 *
 * Cascading children (Contact, BuyerDeliveryAddress, ProductColor, ImageAsset) are the
 * master's OWN data and are deliberately NOT counted — they are meant to go with it.
 *
 * `count` is the truth; `sample` is the handful of linkable rows the panel shows so the
 * owner can see what is actually in the way.
 */

export type MasterKind =
  | "supplier" | "vendor" | "product" | "fabric"
  | "trim" | "buyer" | "colour" | "cuttingMaster";

export type RefSample = { id: number | string; label: string; href: string | null };
export type RefGroup = { label: string; count: number; sample: RefSample[] };
export type MasterRefs = {
  total: number;
  groups: RefGroup[];
  /** The master's own name, for the confirm dialog and the audit summary. */
  name: string;
  /** How this master is retired when it cannot be deleted. */
  deactivate: "active" | "status" | null;
};

const SAMPLE = 5;

/** A group is only reported when something is actually in the way. */
function group(label: string, count: number, sample: RefSample[]): RefGroup[] {
  return count > 0 ? [{ label, count, sample }] : [];
}

export async function getMasterRefs(kind: MasterKind, id: number): Promise<MasterRefs> {
  switch (kind) {
    case "supplier":    return supplierRefs(id);
    case "vendor":      return vendorRefs(id);
    case "product":     return productRefs(id);
    case "fabric":      return fabricRefs(id);
    case "trim":        return trimRefs(id);
    case "buyer":       return buyerRefs(id);
    case "colour":      return colourRefs(id);
    case "cuttingMaster": return cuttingMasterRefs(id);
  }
}

/* ── Supplier ─────────────────────────────────────────────────────────────── */

async function supplierRefs(id: number): Promise<MasterRefs> {
  const row = await db.supplier.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Supplier not found");

  const [trims, fabricOrders, trimOrders, challans, sourcing] = await Promise.all([
    db.trimItem.findMany({ where: { supplierId: id }, select: { id: true, name: true }, take: SAMPLE }),
    db.fabricOrder.findMany({ where: { supplierId: id }, select: { id: true, poNumber: true, fabric: { select: { name: true } } }, take: SAMPLE }),
    db.trimOrder.findMany({ where: { supplierId: id }, select: { id: true, poNumber: true, trimItem: { select: { name: true } } }, take: SAMPLE }),
    db.materialChallan.findMany({ where: { supplierId: id }, select: { id: true, challanNo: true }, take: SAMPLE }),
    db.fabricSupplier.findMany({ where: { supplierId: id }, select: { id: true, fabric: { select: { name: true } } }, take: SAMPLE }),
  ]);
  const [nTrims, nFO, nTO, nCh, nSrc] = await Promise.all([
    db.trimItem.count({ where: { supplierId: id } }),
    db.fabricOrder.count({ where: { supplierId: id } }),
    db.trimOrder.count({ where: { supplierId: id } }),
    db.materialChallan.count({ where: { supplierId: id } }),
    db.fabricSupplier.count({ where: { supplierId: id } }),
  ]);

  const groups = [
    ...group("Trims sourced from them", nTrims, trims.map((t) => ({ id: t.id, label: t.name, href: `/trims/${t.id}` }))),
    ...group("Fabric orders", nFO, fabricOrders.map((o) => ({ id: o.id, label: o.poNumber ?? o.fabric.name, href: "/fabric-orders" }))),
    ...group("Trim orders", nTO, trimOrders.map((o) => ({ id: o.id, label: o.poNumber ?? o.trimItem.name, href: "/trim-orders" }))),
    ...group("Material challans", nCh, challans.map((c) => ({ id: c.id, label: c.challanNo ?? `#${c.id}`, href: `/challan-doc/${c.id}` }))),
    ...group("Fabric sourcing rates", nSrc, sourcing.map((s) => ({ id: s.id, label: s.fabric.name, href: "/inventory" }))),
  ];
  return { total: nTrims + nFO + nTO + nCh + nSrc, groups, name: row.name, deactivate: "active" };
}

/* ── Vendor ───────────────────────────────────────────────────────────────── */

async function vendorRefs(id: number): Promise<MasterRefs> {
  const row = await db.vendor.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Vendor not found");

  // User.vendorName is a plain string matched verbatim against Vendor.name — NOT an FK
  // (schema comment on User.vendorName; resolved by resolveVendorName). No relation
  // count will reveal it, so deleting a vendor would silently break that person's login.
  const [cards, stitches, finishing, layers, challans, logins] = await Promise.all([
    db.jobCard.findMany({ where: { vendorId: id }, select: { id: true, siNo: true }, take: SAMPLE }),
    db.stitchAssignment.count({ where: { vendorId: id } }),
    db.finishingJob.findMany({ where: { vendorId: id }, select: { id: true, docNo: true }, take: SAMPLE }),
    db.cuttingLayer.count({ where: { vendorId: id } }),
    db.materialChallan.count({ where: { vendorId: id } }),
    db.user.findMany({ where: { vendorName: row.name }, select: { id: true, username: true }, take: SAMPLE }),
  ]);
  const [nCards, nFin] = await Promise.all([
    db.jobCard.count({ where: { vendorId: id } }),
    db.finishingJob.count({ where: { vendorId: id } }),
  ]);

  const groups = [
    ...group("Job cards", nCards, cards.map((c) => ({ id: c.id, label: c.siNo, href: `/job-cards/${c.id}` }))),
    ...group("Cutting layers issued to them", layers, []),
    ...group("Finishing / job-work", nFin, finishing.map((f) => ({ id: f.id, label: f.docNo ?? `#${f.id}`, href: "/finishing" }))),
    ...group("Stitch assignments (legacy)", stitches, []),
    ...group("Material challans", challans, []),
    ...group("Logins linked by name", logins.length, logins.map((u) => ({ id: u.id, label: u.username, href: "/users" }))),
  ];
  const total = nCards + layers + nFin + stitches + challans + logins.length;
  return { total, groups, name: row.name, deactivate: "active" };
}

/* ── Product ──────────────────────────────────────────────────────────────── */

async function productRefs(id: number): Promise<MasterRefs> {
  const row = await db.product.findUnique({ where: { id }, select: { name: true, skuCode: true } });
  if (!row) throw new Error("Product not found");

  const [cards, boms, orders] = await Promise.all([
    db.jobCard.findMany({ where: { productId: id }, select: { id: true, siNo: true }, take: SAMPLE }),
    db.bom.count({ where: { productId: id } }),
    db.productionOrder.count({ where: { productId: id } }),
  ]);
  const nCards = await db.jobCard.count({ where: { productId: id } });

  const groups = [
    ...group("Job cards", nCards, cards.map((c) => ({ id: c.id, label: c.siNo, href: `/job-cards/${c.id}` }))),
    ...group("Bills of material", boms, []),
    ...group("Production orders", orders, []),
  ];
  // ProductColor and ImageAsset cascade — they are the product's own data, not blockers.
  return { total: nCards + boms + orders, groups, name: row.name || row.skuCode, deactivate: "status" };
}

/* ── Fabric ───────────────────────────────────────────────────────────────── */

async function fabricRefs(id: number): Promise<MasterRefs> {
  const row = await db.fabric.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Fabric not found");

  const [styles, products, colors, sourcing, movements, returns, jobLines, orders, challanLines] = await Promise.all([
    db.style.count({ where: { fabricId: id } }),
    db.product.findMany({ where: { fabricId: id }, select: { id: true, name: true, skuCode: true }, take: SAMPLE }),
    db.fabricColor.count({ where: { fabricId: id } }),
    db.fabricSupplier.count({ where: { fabricId: id } }),
    db.stockMovement.count({ where: { fabricId: id } }),
    db.returnNote.count({ where: { fabricId: id } }),
    db.jobFabricLine.count({ where: { fabricId: id } }),
    db.fabricOrder.count({ where: { fabricId: id } }),
    db.materialChallanLine.count({ where: { fabricId: id } }),
  ]);
  const nProducts = await db.product.count({ where: { fabricId: id } });

  const groups = [
    ...group("Products using it", nProducts, products.map((p) => ({ id: p.id, label: p.name || p.skuCode, href: `/catalog/${encodeURIComponent(p.skuCode)}` }))),
    ...group("Stock movements", movements, []),
    ...group("Colour stock rows", colors, [{ id, label: row.name, href: `/inventory/${id}` }]),
    ...group("Job card fabric lines", jobLines, []),
    ...group("Fabric orders", orders, []),
    ...group("Challan lines", challanLines, []),
    ...group("Styles", styles, []),
    ...group("Sourcing rates", sourcing, []),
    ...group("Return notes", returns, []),
  ];
  const total = styles + nProducts + colors + sourcing + movements + returns + jobLines + orders + challanLines;
  return { total, groups, name: row.name, deactivate: "active" };
}

/* ── TrimItem ─────────────────────────────────────────────────────────────── */

async function trimRefs(id: number): Promise<MasterRefs> {
  const row = await db.trimItem.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Trim not found");

  const [bomLines, jobBomLines, movements, orders, challanLines] = await Promise.all([
    db.bomLine.count({ where: { trimItemId: id } }),
    db.jobBomLine.count({ where: { trimItemId: id } }),
    db.trimMovement.count({ where: { trimItemId: id } }),
    db.trimOrder.findMany({ where: { trimItemId: id }, select: { id: true, poNumber: true }, take: SAMPLE }),
    db.materialChallanLine.count({ where: { trimItemId: id } }),
  ]);
  const nOrders = await db.trimOrder.count({ where: { trimItemId: id } });

  const groups = [
    ...group("Trim orders", nOrders, orders.map((o) => ({ id: o.id, label: o.poNumber ?? `#${o.id}`, href: "/trim-orders" }))),
    ...group("Stock movements", movements, []),
    ...group("Product BOM lines", bomLines, []),
    ...group("Job card BOM lines", jobBomLines, []),
    ...group("Challan lines", challanLines, []),
  ];
  return { total: bomLines + jobBomLines + movements + nOrders + challanLines, groups, name: row.name, deactivate: "status" };
}

/* ── Buyer ────────────────────────────────────────────────────────────────── */

async function buyerRefs(id: number): Promise<MasterRefs> {
  const row = await db.buyer.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Firm not found");

  const [fabricOrders, trimOrders] = await Promise.all([
    db.fabricOrder.findMany({ where: { buyerId: id }, select: { id: true, poNumber: true }, take: SAMPLE }),
    db.trimOrder.findMany({ where: { buyerId: id }, select: { id: true, poNumber: true }, take: SAMPLE }),
  ]);
  const [nFO, nTO] = await Promise.all([
    db.fabricOrder.count({ where: { buyerId: id } }),
    db.trimOrder.count({ where: { buyerId: id } }),
  ]);

  const groups = [
    ...group("Fabric orders", nFO, fabricOrders.map((o) => ({ id: o.id, label: o.poNumber ?? `#${o.id}`, href: "/fabric-orders" }))),
    ...group("Trim orders", nTO, trimOrders.map((o) => ({ id: o.id, label: o.poNumber ?? `#${o.id}`, href: "/trim-orders" }))),
  ];
  // Contact and BuyerDeliveryAddress cascade — the firm's own data, not blockers.
  return { total: nFO + nTO, groups, name: row.name, deactivate: "active" };
}

/* ── Colour ───────────────────────────────────────────────────────────────── */

async function colourRefs(id: number): Promise<MasterRefs> {
  const row = await db.colour.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Colour not found");

  // Colour is the odd one out: it has ZERO inbound foreign keys. Every document stores
  // the colour as a plain string, canonicalised through colorKey() at the action
  // boundary. So "where used" is a string match, not a relation count. Match both the
  // canonical key and the raw name, since FabricOrder.color predates canonicalisation.
  const key = colorKey(row.name);
  const names = Array.from(new Set([key, row.name]));

  const [orders, movements, stock, jobLines, cells] = await Promise.all([
    db.fabricOrderLine.count({ where: { colour: { in: names } } }),
    db.stockMovement.count({ where: { color: { in: names } } }),
    db.fabricColor.findMany({ where: { color: { in: names } }, select: { id: true, fabricId: true, fabric: { select: { name: true } } }, take: SAMPLE }),
    db.jobFabricLine.count({ where: { color: { in: names } } }),
    db.cuttingLayerCell.count({ where: { colour: { in: names } } }),
  ]);
  const nStock = await db.fabricColor.count({ where: { color: { in: names } } });

  const groups = [
    ...group("Colour stock rows", nStock, stock.map((s) => ({ id: s.id, label: s.fabric.name, href: `/inventory/${s.fabricId}` }))),
    ...group("Stock movements", movements, []),
    ...group("Fabric order lines", orders, []),
    ...group("Job card fabric lines", jobLines, []),
    ...group("Cutting layer cells", cells, []),
  ];
  return { total: orders + movements + nStock + jobLines + cells, groups, name: row.name, deactivate: "active" };
}

/* ── CuttingMaster ────────────────────────────────────────────────────────── */

async function cuttingMasterRefs(id: number): Promise<MasterRefs> {
  const row = await db.cuttingMaster.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw new Error("Cutting master not found");

  const [cards, layers] = await Promise.all([
    db.jobCard.findMany({ where: { cuttingMasterId: id }, select: { id: true, siNo: true }, take: SAMPLE }),
    db.cuttingLayer.count({ where: { cuttingMasterId: id } }),
  ]);
  const nCards = await db.jobCard.count({ where: { cuttingMasterId: id } });

  const groups = [
    ...group("Job cards", nCards, cards.map((c) => ({ id: c.id, label: c.siNo, href: `/job-cards/${c.id}` }))),
    ...group("Cutting layers", layers, []),
  ];
  return { total: nCards + layers, groups, name: row.name, deactivate: "active" };
}

/**
 * The sentence a blocked delete throws. Names the counts and the remedy, in the register
 * the rest of the app uses ("void them first, then delete the card").
 */
export function refsMessage(what: string, refs: MasterRefs): string {
  const parts = refs.groups.map((g) => `${g.count} ${g.label.toLowerCase()}`);
  return `${what} ${refs.name} is used by ${parts.join(", ")} — deactivate it instead`;
}
