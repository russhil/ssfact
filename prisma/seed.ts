import "dotenv/config";
import { scryptSync, randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import seed from "./seed.json";
import catalog from "./seed_catalog.json";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const db = new PrismaClient({ adapter });

const d = (s: string | null | undefined) => (s ? new Date(s) : null);
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

// Deterministic synthesized opening stock for fabrics not in the workbook stock model.
function synthStock(name: string): number {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return 800 + (h % 26) * 90;
}

async function main() {
  console.log("Clearing existing data…");
  await db.returnNote.deleteMany();
  await db.jobBomLine.deleteMany();
  await db.stockMovement.deleteMany();
  await db.sizeBreakup.deleteMany();
  await db.dispatchEvent.deleteMany();
  await db.jobCard.deleteMany();
  await db.productionOrder.deleteMany();
  await db.bomLine.deleteMany();
  await db.bom.deleteMany();
  await db.productColor.deleteMany();
  await db.product.deleteMany();
  await db.trimMovement.deleteMany();
  await db.trimItem.deleteMany();
  await db.user.deleteMany();
  await db.style.deleteMany();
  await db.fabric.deleteMany();
  await db.cuttingMaster.deleteMany();
  await db.vendor.deleteMany();

  // Vendors (+ fallback)
  const vendorNames = new Set(seed.vendors.map((v: any) => v.name));
  vendorNames.add("Unassigned");
  const vendorMap = new Map<string, number>();
  for (const name of vendorNames) {
    const src = seed.vendors.find((v: any) => v.name === name);
    const v = await db.vendor.create({ data: { name, kind: (src?.kind ?? "EXTERNAL") as any } });
    vendorMap.set(name, v.id);
  }

  // Cutting masters
  const cmMap = new Map<string, number>();
  for (const c of seed.cuttingMasters) {
    const r = await db.cuttingMaster.create({ data: { name: c.name } });
    cmMap.set(c.name, r.id);
  }

  // Fabrics (workbook stock) + get-or-create helper for product fabrics
  const fabricMap = new Map<string, number>();
  for (const f of seed.fabrics) {
    const r = await db.fabric.create({
      data: { name: f.name, unit: f.unit as any, openingStock: f.openingStock },
    });
    fabricMap.set(f.name, r.id);
  }
  async function fabricId(name: string | null | undefined): Promise<number | null> {
    if (!name) return null;
    if (fabricMap.has(name)) return fabricMap.get(name)!;
    const r = await db.fabric.create({ data: { name, openingStock: synthStock(name) } });
    fabricMap.set(name, r.id);
    return r.id;
  }

  // Styles (DEPRECATED read-model — kept so the importer's style read stays valid)
  for (const s of seed.styles) {
    await db.style.create({
      data: {
        styleNo: s.styleNo, sku: s.sku, itemDesc: s.itemDesc, mrp: s.mrp,
        category: s.category, avgConsumption: s.avgConsumption, unit: s.unit as any,
        fabricId: await fabricId(s.fabric),
      },
    });
  }

  // ── Product = single master (create BEFORE job cards) ──
  const productMap = new Map<string, number>(); // extId -> id
  for (const p of catalog.products as any[]) {
    const r = await db.product.create({
      data: {
        extId: p.extId, skuCode: p.skuCode, normSku: p.normSku, styleNo: p.styleNo,
        name: p.name, itemDesc: p.itemDesc, headCategory: p.headCategory,
        mrp: p.mrp, customWsRate: p.customWsRate, status: p.status as any,
        styleGroup: p.styleGroup, bomCode: p.bomCode,
        avgConsumption: p.avgConsumption, unit: (p.unit ?? "MTR") as any,
        fabricId: await fabricId(p.fabric), imageUrl: p.imageUrl,
        sizeRatioJson: p.sizeRatioJson, colorRatioJson: p.colorRatioJson,
        colors: { create: (p.colors ?? []).map((c: any) => ({ name: c.name, hex: c.hex, sortOrder: c.sortOrder })) },
      },
    });
    productMap.set(p.extId, r.id);
  }
  // style normSku -> productId (every job card maps through this)
  const styleToProduct = new Map<string, number>();
  for (const [snorm, ext] of Object.entries(catalog.styleNormToProductExtId as Record<string, string>)) {
    const pid = productMap.get(ext);
    if (pid) styleToProduct.set(snorm, pid);
  }

  // Job cards (re-pointed to productId)
  let made = 0, orphan = 0;
  for (const j of seed.jobCards) {
    const productId = styleToProduct.get(norm(j.styleNo));
    if (!productId) { orphan++; continue; }
    const vendorId = (j.vendor ? vendorMap.get(j.vendor) : undefined) ?? vendorMap.get("Unassigned")!;
    const cuttingMasterId = j.cuttingMaster ? cmMap.get(j.cuttingMaster) ?? null : null;
    const issueQty = j.fabricConsumed ?? (j.cutQty && j.avgConsumption ? j.cutQty * j.avgConsumption : null);
    const fid = await fabricId(j.fabric);
    const stage = j.status === "CLOSED" ? "DISPATCH" : (j.dispatchedQty ?? 0) > 0 ? "STITCHING" : "CUTTING";

    await db.jobCard.create({
      data: {
        siNo: j.siNo, orderDate: d(j.orderDate), cutQty: j.cutQty, dispatchedQty: j.dispatchedQty,
        estAvg: j.avgConsumption, estFabric: issueQty,
        avgConsumption: j.avgConsumption, fabricIssued: j.fabricIssued, fabricConsumed: j.fabricConsumed,
        fabricIssueDate: d(j.fabricIssueDate), cuttingIssuedOn: d(j.cuttingIssuedOn),
        plannedEtd: d(j.plannedEtd), status: j.status as any, stage: stage as any, remark: j.remark,
        productId, vendorId, cuttingMasterId,
        dispatches: { create: j.dispatches.map((e: any) => ({ date: new Date(e.date), qty: e.qty })) },
        sizeBreakup: { create: j.sizeBreakup.map((s: any) => ({ size: s.size, qty: s.qty })) },
        movements:
          fid && issueQty
            ? { create: [{ type: "ISSUE" as any, qty: issueQty, date: d(j.fabricIssueDate) ?? d(j.cuttingIssuedOn) ?? d(j.orderDate) ?? new Date(), fabricId: fid }] }
            : undefined,
      },
    });
    made++;
  }

  // Trim items + movements
  const trimMap = new Map<string, number>();
  for (const t of catalog.trimItems as any[]) {
    const r = await db.trimItem.create({
      data: { sno: t.sno, name: t.name, normName: t.normName, family: t.family, openingStock: t.openingStock ?? 0, currentStock: t.currentStock ?? 0 },
    });
    trimMap.set(t.normName, r.id);
  }
  let tmoves = 0;
  for (const m of catalog.trimMovements as any[]) {
    const trimItemId = trimMap.get(m.itemNorm);
    if (!trimItemId) continue;
    await db.trimMovement.create({
      data: { type: m.type as any, qty: m.qty, date: d(m.date), invoice: m.invoice, rate: m.rate, vendor: m.vendor, trimItemId },
    });
    tmoves++;
  }

  // BOMs + lines
  for (const b of catalog.boms as any[]) {
    const productId = b.productExtId ? productMap.get(b.productExtId) ?? null : null;
    await db.bom.create({
      data: {
        code: b.code, styleName: b.styleName, productId,
        lines: { create: b.lines.map((l: any) => ({ sNo: l.sNo, material: l.material, color: l.color, qty: l.qty, avg: l.avg, trimItemId: l.trimMatchNorm ? trimMap.get(l.trimMatchNorm) ?? null : null })) },
      },
    });
  }

  // Production orders
  let pos = 0;
  for (const o of catalog.productionOrders as any[]) {
    const productId = productMap.get(o.productExtId);
    if (!productId) continue;
    await db.productionOrder.create({
      data: { orderNo: o.orderNo, productId, orderDate: d(o.orderDate), targetQty: o.targetQty, avgMonthlySale: o.avgMonthlySale, status: o.status as any, urgency: o.urgency, remarks: o.remarks },
    });
    pos++;
  }

  // Users (role-based login)
  const pw = process.env.SEED_PASSWORD ?? "sportsun123";
  for (const u of (catalog.users as any[]) ?? []) {
    await db.user.create({
      data: { username: u.username, displayName: u.displayName, role: u.role as any, vendorName: u.vendorName, passwordHash: hashPassword(pw) },
    });
  }

  console.log(`Seeded: ${vendorMap.size} vendors, ${cmMap.size} cutting masters, ${fabricMap.size} fabrics, ${made} job cards (${orphan} orphan).`);
  console.log(`Commercial: ${productMap.size} products, ${trimMap.size} trims, ${tmoves} trim moves, ${catalog.boms.length} BOMs, ${pos} POs, ${(catalog.users as any[]).length} users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
