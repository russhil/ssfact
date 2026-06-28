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
// Colour key: stock/colours are matched case-insensitively & whitespace-collapsed.
const cu = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
// Deterministic per-colour buffer so utilisation varies (≈63–91% used) instead of flat.
function colorBuffer(seed: string): number {
  const buckets = [1.1, 1.22, 1.35, 1.5, 1.6];
  const h = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return buckets[h % buckets.length];
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

// Deterministic synthesized opening stock for fabrics not in the workbook stock model.
function synthStock(name: string): number {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return 800 + (h % 26) * 90;
}

// Map the legacy free-text trim family → the 7 unified head categories (Change 05).
function familyToCategory(family: string | null | undefined): string | null {
  const f = (family ?? "").toUpperCase();
  if (!f) return null;
  if (f.includes("BUTTON")) return "BUTTON";
  if (f.includes("ZIP")) return "ZIP";
  if (f.includes("TAG")) return "TAG";
  if (f.includes("CARDBOARD") || f.includes("CARTON")) return "CARDBOARD";
  if (f.includes("MASTERPACK") || f.includes("MASTER PACK")) return "MASTERPACK";
  if (f.includes("LABEL") || f.includes("LABLE") || f.includes("TICKET") || f.includes("STICKER") || f.includes("HEAT"))
    return "LABEL";
  if (f.includes("PACKAGING") || f.includes("POLY") || f.includes("PANNI")) return "POLYBAG";
  // tapes, threads, cords, elastic, fusing, hanger, collar, reflector → OTHER
  if (
    ["THREAD", "NIWAD", "NADA", "ELASTIC", "SHOULDER", "FUSING", "HANGER", "COLLAR", "CORD", "REFLECT"].some((k) =>
      f.includes(k)
    )
  )
    return "OTHER";
  return "OTHER";
}

// BOM consumption pattern inferred from the trim's family (Change 02).
function dimensionForFamily(family: string | null | undefined): "COLOR" | "SIZE" | "FLAT" {
  const f = (family ?? "").toUpperCase();
  if (["THREAD", "NIWAD", "HEAT", "COLLAR", "CORD", "NADA"].some((k) => f.includes(k))) return "COLOR";
  if (f.includes("LABEL") || f.includes("LABLE") || f.includes("TICKET")) return "SIZE";
  return "FLAT";
}

// Clean a free-text vendor/supplier name; null for junk.
function cleanSupplier(s: string | null | undefined): string | null {
  const v = (s ?? "").trim().replace(/\s+/g, " ");
  if (!v || /^(TBC|NA|N\/A|\?|-)$/i.test(v)) return null;
  return v;
}

async function main() {
  console.log("Clearing existing data…");
  await db.returnNote.deleteMany();
  await db.jobFabricLine.deleteMany();
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
  await db.fabricOrder.deleteMany();
  await db.supplier.deleteMany();
  await db.user.deleteMany();
  await db.style.deleteMany();
  await db.fabricColor.deleteMany();
  await db.fabricSupplier.deleteMany();
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
  const fabricOpening = new Map<string, number>(); // name -> openingStock (for per-colour split)
  for (const f of seed.fabrics) {
    const r = await db.fabric.create({
      data: { name: f.name, unit: f.unit as any, openingStock: f.openingStock },
    });
    fabricMap.set(f.name, r.id);
    fabricOpening.set(f.name, f.openingStock);
  }
  async function fabricId(name: string | null | undefined): Promise<number | null> {
    if (!name) return null;
    if (fabricMap.has(name)) return fabricMap.get(name)!;
    const opening = synthStock(name);
    const r = await db.fabric.create({ data: { name, openingStock: opening } });
    fabricMap.set(name, r.id);
    fabricOpening.set(name, opening);
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
  const fabricPalette = new Map<string, Set<string>>(); // fabricName -> set of colour keys
  for (const p of catalog.products as any[]) {
    if (p.fabric) {
      const set = fabricPalette.get(p.fabric) ?? new Set<string>();
      for (const c of p.colors ?? []) if (c?.name) set.add(cu(c.name));
      fabricPalette.set(p.fabric, set);
    }
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

  // ── Per-colour fabric stock (FabricColor) ──
  // Pre-scan job cards for real per-colour fabric issued (workbook FABRIC DETAIL block),
  // then seed a FabricColor balance per (fabric, colour) = palette ∪ colours actually issued.
  const colorIssued = new Map<string, Map<string, number>>(); // fabricName -> colourKey -> Σ reqMtr
  for (const j of seed.jobCards as any[]) {
    if (!j.fabric || !Array.isArray(j.fabricColors)) continue;
    const m = colorIssued.get(j.fabric) ?? new Map<string, number>();
    for (const fc of j.fabricColors) {
      const mtr = typeof fc.reqMtr === "number" ? fc.reqMtr : 0;
      if (!fc.color || mtr <= 0) continue;
      const k = cu(fc.color);
      m.set(k, (m.get(k) ?? 0) + mtr);
    }
    if (m.size) colorIssued.set(j.fabric, m);
  }
  // fabricId|colourKey -> FabricColor id (for decrement in the job-card loop)
  const fabricColorMap = new Map<string, number>();
  let fcRows = 0;
  for (const [name, fid] of fabricMap) {
    const palette = fabricPalette.get(name) ?? new Set<string>();
    const issued = colorIssued.get(name) ?? new Map<string, number>();
    const colours = new Set<string>([...palette, ...issued.keys()]);
    if (colours.size === 0) continue; // fabric with no colours → legacy fabric-level fallback
    const evenSplit = Math.round((fabricOpening.get(name) ?? 0) / colours.size);
    for (const colour of colours) {
      const used = issued.get(colour) ?? 0;
      // Opening covers historical issues + headroom, or the even split — whichever is larger.
      const opening = Math.max(evenSplit, Math.round(used * colorBuffer(name + colour)), 1);
      const r = await db.fabricColor.create({
        data: { fabricId: fid, color: colour, openingStock: opening, currentStock: opening },
      });
      fabricColorMap.set(`${fid}|${colour}`, r.id);
      fcRows++;
    }
  }

  // Job cards (re-pointed to productId)
  let made = 0, orphan = 0;
  const seededJobs: { id: number; productId: number; cutQty: number; status: string }[] = [];
  for (const j of seed.jobCards) {
    const productId = styleToProduct.get(norm(j.styleNo));
    if (!productId) { orphan++; continue; }
    const vendorId = (j.vendor ? vendorMap.get(j.vendor) : undefined) ?? vendorMap.get("Unassigned")!;
    const cuttingMasterId = j.cuttingMaster ? cmMap.get(j.cuttingMaster) ?? null : null;
    const issueQty = j.fabricConsumed ?? (j.cutQty && j.avgConsumption ? j.cutQty * j.avgConsumption : null);
    const fid = await fabricId(j.fabric);
    const stage = j.status === "CLOSED" ? "DISPATCH" : (j.dispatchedQty ?? 0) > 0 ? "STITCHING" : "CUTTING";
    const issueDate = d(j.fabricIssueDate) ?? d(j.cuttingIssuedOn) ?? d(j.orderDate) ?? new Date();

    // Real per-colour fabric issued (workbook FABRIC DETAIL block), where present.
    const perColour: { color: string; reqMtr: number | null; reqPcs: number | null }[] =
      fid && Array.isArray((j as any).fabricColors)
        ? (j as any).fabricColors
            .map((fc: any) => ({
              color: cu(fc.color),
              reqMtr: typeof fc.reqMtr === "number" ? fc.reqMtr : null,
              reqPcs: typeof fc.reqPcs === "number" ? fc.reqPcs : null,
            }))
            .filter((fc: { color: string }) => fc.color)
        : [];
    const colourIssues = perColour.filter((fc) => fc.reqMtr && fc.reqMtr > 0);

    const movementsCreate =
      colourIssues.length > 0
        ? colourIssues.map((fc) => ({
            type: "ISSUE" as any, qty: fc.reqMtr!, date: issueDate, fabricId: fid!, color: fc.color,
          }))
        : fid && issueQty
          ? [{ type: "ISSUE" as any, qty: issueQty, date: issueDate, fabricId: fid }]
          : [];

    const created = await db.jobCard.create({
      data: {
        siNo: j.siNo, orderDate: d(j.orderDate), cutQty: j.cutQty, dispatchedQty: j.dispatchedQty,
        estAvg: j.avgConsumption, estFabric: issueQty,
        avgConsumption: j.avgConsumption, fabricIssued: j.fabricIssued, fabricConsumed: j.fabricConsumed,
        fabricIssueDate: d(j.fabricIssueDate), cuttingIssuedOn: d(j.cuttingIssuedOn),
        plannedEtd: d(j.plannedEtd), status: j.status as any, stage: stage as any, remark: j.remark,
        productId, vendorId, cuttingMasterId,
        dispatches: { create: j.dispatches.map((e: any) => ({ date: new Date(e.date), qty: e.qty })) },
        sizeBreakup: { create: j.sizeBreakup.map((s: any) => ({ size: s.size, qty: s.qty })) },
        movements: movementsCreate.length ? { create: movementsCreate } : undefined,
        fabricLines: perColour.length
          ? {
              create: perColour.map((fc) => ({
                color: fc.color, fabricId: fid!, cutQty: fc.reqPcs ?? 0,
                estAvg: j.avgConsumption ?? null, qtyIssued: fc.reqMtr ?? null,
              })),
            }
          : undefined,
      },
    });

    // Decrement the matching per-colour stock for every real colour issue.
    for (const fc of colourIssues) {
      const key = `${fid}|${fc.color}`;
      let fcId = fabricColorMap.get(key);
      if (!fcId) {
        const opening = Math.round(fc.reqMtr! * 1.3);
        const r = await db.fabricColor.create({
          data: { fabricId: fid!, color: fc.color, openingStock: opening, currentStock: opening },
        });
        fcId = r.id;
        fabricColorMap.set(key, r.id);
        fcRows++;
      }
      await db.fabricColor.update({ where: { id: fcId }, data: { currentStock: { decrement: fc.reqMtr! } } });
    }
    seededJobs.push({ id: created.id, productId, cutQty: j.cutQty ?? 0, status: j.status });
    made++;
  }

  // Pre-scan trim movements → latest rate + representative vendor per trim (for the master).
  const trimRate = new Map<string, number>();
  const trimVendor = new Map<string, string>();
  for (const m of catalog.trimMovements as any[]) {
    if (typeof m.rate === "number" && m.rate > 0) trimRate.set(m.itemNorm, m.rate);
    const v = cleanSupplier(m.vendor);
    if (v) trimVendor.set(m.itemNorm, v);
  }

  // Supplier master — seed from distinct trim-movement vendors (Change 05 Part A).
  const supplierByName = new Map<string, number>(); // UPPER name -> id
  for (const raw of new Set([...trimVendor.values()].map((v) => v))) {
    const key = raw.toUpperCase();
    if (supplierByName.has(key)) continue;
    const s = await db.supplier.create({ data: { name: raw } });
    supplierByName.set(key, s.id);
  }

  // Trim items (unified master) + movements
  const trimMap = new Map<string, number>();
  const trimFamilyByNorm = new Map<string, string | null>();
  const trimStockByNorm = new Map<string, number>(); // snapshot for pending calc
  for (const t of catalog.trimItems as any[]) {
    const vendor = trimVendor.get(t.normName);
    const supplierId = vendor ? supplierByName.get(vendor.toUpperCase()) ?? null : null;
    const r = await db.trimItem.create({
      data: {
        sno: t.sno, name: t.name, normName: t.normName, family: t.family,
        openingStock: t.openingStock ?? 0, currentStock: t.currentStock ?? 0,
        category: familyToCategory(t.family) as any,
        unit: "pcs", status: "ACTIVE",
        ratePerUnit: trimRate.get(t.normName) ?? null,
        supplierId,
      },
    });
    trimMap.set(t.normName, r.id);
    trimFamilyByNorm.set(t.normName, t.family ?? null);
    trimStockByNorm.set(t.normName, t.currentStock ?? 0);
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

  // BOMs + lines (perPieceQty + dimension now drive the editable trim sheet — Change 02)
  const bomByProductId = new Map<number, any[]>(); // productId -> exploded-ready line specs
  for (const b of catalog.boms as any[]) {
    const productId = b.productExtId ? productMap.get(b.productExtId) ?? null : null;
    const lines = b.lines.map((l: any) => {
      const trimNorm = l.trimMatchNorm ?? null;
      const trimItemId = trimNorm ? trimMap.get(trimNorm) ?? null : null;
      const dimension = dimensionForFamily(trimNorm ? trimFamilyByNorm.get(trimNorm) : null);
      return {
        sNo: l.sNo, material: l.material, color: l.color, qty: l.qty,
        perPieceQty: l.qty, dimension: dimension as any, avg: l.avg, trimItemId, trimNorm,
      };
    });
    await db.bom.create({
      data: {
        code: b.code, styleName: b.styleName, productId,
        lines: { create: lines.map(({ trimNorm, ...rest }: any) => rest) },
      },
    });
    if (productId) bomByProductId.set(productId, (bomByProductId.get(productId) ?? []).concat(lines));
  }

  // Historical BOM snapshot per job card (JobBomLine) + Pending-Trims flag.
  // requiredQty = perPieceQty × cutQty (Σ over colours/sizes = cutQty for any dimension).
  // currentStock is already net of historical consumption, so we do NOT re-deplete.
  let jbl = 0, pendingCards = 0;
  for (const jc of seededJobs) {
    const lines = bomByProductId.get(jc.productId) ?? [];
    if (!lines.length) continue;
    const closed = jc.status === "CLOSED";
    let pending = false;
    const create = lines.map((l: any) => {
      const required = (l.perPieceQty ?? 0) * jc.cutQty;
      const stock = l.trimNorm ? trimStockByNorm.get(l.trimNorm) ?? 0 : 0;
      if (!closed && l.trimItemId && required > stock) pending = true;
      return {
        material: l.material, color: l.color, dimension: l.dimension,
        perPieceQty: l.perPieceQty, totalQty: required, requiredQty: required,
        issuedQty: closed ? required : 0, trimItemId: l.trimItemId,
      };
    });
    await db.jobBomLine.createMany({ data: create.map((c: any) => ({ ...c, jobCardId: jc.id })) });
    jbl += create.length;
    if (pending) {
      await db.jobCard.update({ where: { id: jc.id }, data: { trimsPending: true } });
      pendingCards++;
    }
  }

  // Fabric orders — demo procurement pipeline (Change 05 Part C)
  const anySupplier = [...supplierByName.values()][0] ?? null;
  const fabricOrderSpecs: { fabric: string; color: string; qty: number; status: string; days: number; rate: number }[] = [
    { fabric: "Max Polo", color: "NAVY", qty: 1500, status: "ORDER_PLACED", days: 12, rate: 320 },
    { fabric: "Max Polo", color: "BLACK", qty: 1200, status: "PLANNING", days: 0, rate: 320 },
    { fabric: "Ns Cotton", color: "AIR FORCE", qty: 2000, status: "ORDER_PLACED", days: 8, rate: 285 },
    { fabric: "Playcool Eco", color: "BLACK", qty: 1800, status: "RECEIVED", days: -5, rate: 410 },
    { fabric: "Polyster Terry", color: "NAVY", qty: 900, status: "SAMPLE_PENDING", days: 20, rate: 260 },
    { fabric: "Fourway Lycra", color: "BLACK", qty: 1100, status: "PLANNING", days: 0, rate: 540 },
    { fabric: "Popcorn", color: "BLACK", qty: 700, status: "ORDER_PLACED", days: 15, rate: 375 },
    { fabric: "Playcool Eco", color: "NAVY", qty: 1300, status: "RECEIVED", days: -12, rate: 410 },
  ];
  let fos = 0;
  const today = new Date();
  for (const s of fabricOrderSpecs) {
    const fid = fabricMap.get(s.fabric);
    if (!fid) continue;
    const expected = new Date(today.getTime() + s.days * 86_400_000);
    await db.fabricOrder.create({
      data: {
        fabricId: fid, color: cu(s.color), supplierId: anySupplier, qty: s.qty, rate: s.rate,
        status: s.status as any, orderDate: today,
        expectedDate: s.status === "RECEIVED" ? null : expected,
        receivedDate: s.status === "RECEIVED" ? expected : null,
      },
    });
    fos++;
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

  console.log(`Seeded: ${vendorMap.size} vendors, ${cmMap.size} cutting masters, ${fabricMap.size} fabrics, ${fcRows} fabric colours, ${made} job cards (${orphan} orphan).`);
  console.log(`Commercial: ${productMap.size} products, ${trimMap.size} trims, ${tmoves} trim moves, ${catalog.boms.length} BOMs, ${pos} POs, ${(catalog.users as any[]).length} users.`);
  console.log(`Change 05: ${supplierByName.size} suppliers, ${fos} fabric orders. BOM snapshot: ${jbl} job-bom lines, ${pendingCards} cards flagged trims-pending.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
