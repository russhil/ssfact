/**
 * Demo data for Changes 36 + 37 — a believable factory quarter.
 *
 * The go-live reset left every master in place and every transaction empty, which means
 * the new screens (accounts, planning, yield, scorecards, trace, quality) all render
 * correctly and show nothing. This builds enough real-shaped history to actually judge
 * them.
 *
 *   npm run seed:demo
 *
 * ⚠️ LOCAL ONLY. It refuses to run against anything but a dev.db, and it clears the
 * transactional tables first so it can be re-run. Masters — products, fabrics, colours,
 * vendors, suppliers, trims — are never touched.
 *
 * Everything is dated backwards from today so the ageing buckets, on-time scores and
 * overdue flags have something to bite on.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
if (!/dev\.db/.test(url)) {
  console.error(`REFUSING TO RUN — DATABASE_URL is "${url}", which is not a local dev.db.`);
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const DAY = 86400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);
const pick = <T,>(xs: T[], i: number) => xs[i % xs.length];

/* ── 0. clear only what this script owns ─────────────────────────────────── */

await db.$transaction(async (tx) => {
  await tx.inspectionDefect.deleteMany();
  await tx.inspection.deleteMany();
  await tx.rework.deleteMany();
  await tx.sampleCostLine.deleteMany();
  await tx.sampleMeasurement.deleteMany();
  await tx.sample.deleteMany();
  await tx.partyLedgerEntry.deleteMany();
  await tx.notification.deleteMany();
  await tx.returnNote.deleteMany();
  await tx.dispatchLine.deleteMany();
  await tx.dispatchEvent.deleteMany();
  await tx.cuttingLayerColour.deleteMany();
  await tx.cuttingLayerCell.deleteMany();
  await tx.cuttingLayer.deleteMany();
  await tx.jobFabricLine.deleteMany();
  await tx.jobBomLine.deleteMany();
  await tx.sizeBreakup.deleteMany();
  await tx.stockMovement.deleteMany();
  await tx.materialChallanLine.deleteMany();
  await tx.materialChallan.deleteMany();
  await tx.jobCard.deleteMany();
  await tx.fabricOrderLine.deleteMany();
  await tx.fabricOrder.deleteMany();
  await tx.trimOrderLine.deleteMany();
  await tx.trimOrder.deleteMany();
});
console.log("cleared previous demo data (masters untouched)");

/* ── 1. the cast, taken from real masters ────────────────────────────────── */

const products = await db.product.findMany({
  where: { fabricId: { not: null }, avgConsumption: { not: null } },
  select: { id: true, name: true, skuCode: true, fabricId: true, avgConsumption: true, unit: true },
  take: 6,
});
const vendors = await db.vendor.findMany({
  where: { name: { notIn: ["Unassigned"] }, active: true },
  select: { id: true, name: true },
  take: 5,
});
const suppliers = await db.supplier.findMany({ select: { id: true, name: true }, take: 3 });
const masters = await db.cuttingMaster.findMany({ where: { active: true }, select: { id: true, name: true }, take: 3 });
const admin = await db.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, username: true } });

if (!products.length || vendors.length < 3 || suppliers.length < 3) {
  console.error("Not enough masters to build demo data — is this the baseline dev.db?");
  process.exit(1);
}

const COLOURS = ["BLACK", "NAVY", "WHITE", "MAROON"];
const SIZES = ["S", "M", "L", "XL"];

/* ── 2. Part 4 — one entered number per vendor (one deliberately swamped) ── */

const CAPACITY = [180, 120, 90, 250, 60];
for (let i = 0; i < vendors.length; i++) {
  await db.vendor.update({
    where: { id: vendors[i].id },
    data: {
      dailyCapacityPcs: CAPACITY[i] ?? 100,
      capacityNote: i === 2 ? "2 lines, 18 machines" : null,
      // Part 1 — job-work rates, so the accounts have something to bill on.
      jobRate: [42, 38, 55, 30, 48][i] ?? 40,
      jobRateType: "PER_PIECE",
      phone: i === 0 ? "9810000001" : null,
    },
  });
}
console.log(`set capacity + job rates on ${vendors.length} vendors`);

/* ── 3. Part 6 — purchase orders that score differently ──────────────────── */
//
// Deliberately varied so the scorecard is not uniformly green:
//   A  full delivery, early           → on time
//   B  20% early, 80% a month late    → LATE on full receipt (the split-delivery trap)
//   C  short — only 60% ever arrived  → open, drags the fill rate
//   D  full, on the promised day      → on time
//   E  late                           → late

type POSpec = { sup: number; qty: number; rate: number; ordered: number; expected: number; deliveries: [number, number][]; lot: string };
const POS: POSpec[] = [
  { sup: 0, qty: 400, rate: 142, ordered: 96, expected: 82, deliveries: [[84, 400]], lot: "LOT-4471" },
  { sup: 0, qty: 300, rate: 138, ordered: 78, expected: 64, deliveries: [[66, 60], [34, 240]], lot: "LOT-4488" },
  { sup: 1, qty: 500, rate: 155, ordered: 60, expected: 46, deliveries: [[48, 300]], lot: "LOT-5120" },
  { sup: 1, qty: 250, rate: 150, ordered: 40, expected: 26, deliveries: [[26, 250]], lot: "LOT-5133" },
  { sup: 2, qty: 350, rate: 168, ordered: 30, expected: 16, deliveries: [[8, 350]], lot: "LOT-6002" },
];

const challanIds: { id: number; lot: string }[] = [];
let chN = 0;
for (let i = 0; i < POS.length; i++) {
  const p = POS[i];
  const prod = pick(products, i);
  const order = await db.fabricOrder.create({
    data: {
      fabricId: prod.fabricId!,
      supplierId: suppliers[p.sup].id,
      qty: p.qty,
      rate: p.rate,
      unit: prod.unit,
      status: "ORDER_PLACED",
      orderDate: ago(p.ordered),
      expectedDate: ago(p.expected),
      poNumber: `PO-2026-${String(i + 1).padStart(3, "0")}`,
      lines: { create: [{ colour: COLOURS[i % COLOURS.length], qty: p.qty }] },
    },
  });

  for (const [daysAgo, qty] of p.deliveries) {
    chN++;
    const ch = await db.materialChallan.create({
      data: {
        direction: "INWARD",
        status: "LOCKED",
        challanNo: `CH-IN-2026-${String(chN).padStart(3, "0")}`,
        date: ago(daysAgo),
        lockedAt: ago(daysAgo),
        supplierId: suppliers[p.sup].id,
        fabricOrderId: order.id,
        lines: {
          create: [{
            fabricId: prod.fabricId!,
            colour: COLOURS[i % COLOURS.length],
            qty,
            rate: p.rate,
            // Part 8 — the lot that makes tracing possible.
            lotNo: p.lot,
            shadeRef: `SH-${900 + i}`,
          }],
        },
      },
    });
    challanIds.push({ id: ch.id, lot: p.lot });

    // stock actually arrives
    const fc = await db.fabricColor.upsert({
      where: { fabricId_color: { fabricId: prod.fabricId!, color: COLOURS[i % COLOURS.length] } },
      create: { fabricId: prod.fabricId!, color: COLOURS[i % COLOURS.length], openingStock: 0, currentStock: 0 },
      update: {},
    });
    await db.stockMovement.create({
      data: { type: "RECEIPT", qty, date: ago(daysAgo), fabricId: prod.fabricId!, color: COLOURS[i % COLOURS.length], note: `Challan ${ch.challanNo}` },
    });
    await db.fabricColor.update({ where: { id: fc.id }, data: { currentStock: { increment: qty } } });
  }
}
console.log(`${POS.length} purchase orders, ${chN} inward challans with lot numbers`);

/* ── 4. Change 37 + Parts 3/5/8 — the job cards ──────────────────────────── */
//
// Mixed on purpose: per-colour lays AND legacy lays on the same card, so both ledger
// paths are visible and verify:ledger has something real to check.

type CardSpec = {
  si: string; prod: number; vendor: number; cut: number; disp: number;
  created: number; etd: number; stage: string;
  perColour: boolean; overCut: boolean; lot?: string;
};
const CARDS: CardSpec[] = [
  { si: "SI-01", prod: 0, vendor: 0, cut: 600, disp: 600, created: 88, etd: -60, stage: "DISPATCH", perColour: true, overCut: false, lot: "LOT-4471" },
  { si: "SI-02", prod: 1, vendor: 1, cut: 450, disp: 300, created: 70, etd: -20, stage: "ON_MACHINE", perColour: true, overCut: true, lot: "LOT-4488" },
  { si: "SI-03", prod: 2, vendor: 2, cut: 800, disp: 200, created: 45, etd: 3, stage: "ON_MACHINE", perColour: true, overCut: false, lot: "LOT-5120" },
  { si: "SI-04", prod: 3, vendor: 0, cut: 300, disp: 300, created: 40, etd: -10, stage: "DISPATCH", perColour: false, overCut: false },
  { si: "SI-05", prod: 4, vendor: 3, cut: 1200, disp: 400, created: 30, etd: 12, stage: "CUTTING", perColour: true, overCut: false, lot: "LOT-5133" },
  { si: "SI-06", prod: 0, vendor: 2, cut: 500, disp: 0, created: 12, etd: -2, stage: "FABRIC_AWAITED", perColour: false, overCut: false },
  { si: "SI-07", prod: 1, vendor: 4, cut: 250, disp: 250, created: 100, etd: -80, stage: "DISPATCH", perColour: true, overCut: false, lot: "LOT-6002" },
];

const cardIds: { id: number; si: string; vendor: string; cut: number; disp: number }[] = [];
let dcN = 0;

for (let i = 0; i < CARDS.length; i++) {
  const c = CARDS[i];
  const prod = products[c.prod % products.length];
  const vend = vendors[c.vendor % vendors.length];
  const std = prod.avgConsumption ?? 0.2;

  const job = await db.jobCard.create({
    data: {
      siNo: c.si,
      productId: prod.id,
      vendorId: vend.id,
      cuttingMasterId: pick(masters, i)?.id ?? null,
      status: c.disp >= c.cut ? "CLOSED" : "ACTIVE",
      stage: c.stage as never,
      cutQty: c.cut,
      dispatchedQty: c.disp,
      estAvg: std,
      orderDate: ago(c.created),
      plannedEtd: c.etd < 0 ? ago(-c.etd) : ahead(c.etd),
      createdAt: ago(c.created),
      merchandiser: pick(["Jyotika", "Satya", "—"], i),
    },
  });

  // Two colours per card, split roughly 60/40.
  const cA = COLOURS[i % COLOURS.length];
  const cB = COLOURS[(i + 1) % COLOURS.length];
  const qA = Math.round(c.cut * 0.6);
  const qB = c.cut - qA;

  // A lay's fabric. Per-colour cards get real entered figures; legacy cards get only the
  // lay total, which still takes the old proportional split.
  const usedA = Math.round(qA * std * (c.overCut ? 1.18 : 1.02) * 100) / 100;
  const usedB = Math.round(qB * std * (c.overCut ? 1.25 : 1.04) * 100) / 100;
  const issA = Math.round(usedA * (c.overCut ? 0.92 : 1.05) * 100) / 100;
  const issB = Math.round(usedB * (c.overCut ? 0.9 : 1.06) * 100) / 100;

  await db.cuttingLayer.create({
    data: {
      jobCardId: job.id,
      layerNo: 1,
      label: `LAYER-1`,
      cutDate: ago(c.created - 2),
      cuttingMasterId: pick(masters, i)?.id ?? null,
      vendorId: vend.id,
      avgConsumption: std,
      rolls: 6 + (i % 5),
      fabricMtr: c.perColour ? Math.round((usedA + usedB) * 100) / 100 : Math.round((usedA + usedB) * 100) / 100,
      fabricIssued: c.perColour ? Math.round((issA + issB) * 100) / 100 : null,
      fabricLotNo: c.lot ?? null,
      // Part 1 — a layer-level rate override on one card, to prove it beats the vendor default.
      vendorRate: i === 1 ? 61 : null,
      cells: {
        create: [
          ...SIZES.map((s, k) => ({ colour: cA, size: s, qty: Math.round(qA / SIZES.length) + (k === 0 ? qA % SIZES.length : 0) })),
          ...SIZES.map((s, k) => ({ colour: cB, size: s, qty: Math.round(qB / SIZES.length) + (k === 0 ? qB % SIZES.length : 0) })),
        ],
      },
      ...(c.perColour
        ? { colours: { create: [
            { colour: cA, fabricIssued: issA, fabricUsed: usedA },
            { colour: cB, fabricIssued: issB, fabricUsed: usedB },
          ] } }
        : {}),
    },
  });

  // Per-colour fabric lines + the ledger, driven to the entered USED.
  for (const [col, cutQ, used, iss] of [[cA, qA, usedA, issA], [cB, qB, usedB, issB]] as [string, number, number, number][]) {
    await db.jobFabricLine.create({
      data: {
        color: col, fabricId: prod.fabricId!, jobCardId: job.id,
        cutQty: cutQ, estAvg: std,
        qtyIssued: iss,
        qtyUsed: c.perColour ? used : null,
      },
    });
    const postQty = c.perColour ? used : iss;
    const fc = await db.fabricColor.upsert({
      where: { fabricId_color: { fabricId: prod.fabricId!, color: col } },
      create: { fabricId: prod.fabricId!, color: col, openingStock: 0, currentStock: 0 },
      update: {},
    });
    await db.stockMovement.create({
      data: { type: "ISSUE", qty: postQty, date: ago(c.created - 2), fabricId: prod.fabricId!, color: col, jobCardId: job.id, note: "Cutting issue" },
    });
    await db.fabricColor.update({ where: { id: fc.id }, data: { currentStock: { decrement: postQty } } });
  }

  // Dispatch what came back.
  if (c.disp > 0) {
    dcN++;
    const ev = await db.dispatchEvent.create({
      data: {
        jobCardId: job.id, qty: c.disp, date: ago(Math.max(1, c.created - 20)),
        dispatchNo: `DC-2026-${String(dcN).padStart(3, "0")}`,
        reason: "ORDER",
        lines: { create: SIZES.map((s) => ({ colour: cA, size: s, qty: Math.round(c.disp / SIZES.length) })) },
      },
    });
    const layer = await db.cuttingLayer.findFirst({ where: { jobCardId: job.id }, select: { id: true } });
    if (layer) await db.dispatchEvent.update({ where: { id: ev.id }, data: { layers: { connect: { id: layer.id } } } });
  }

  cardIds.push({ id: job.id, si: c.si, vendor: vend.name, cut: c.cut, disp: c.disp });
}
console.log(`${CARDS.length} job cards (4 per-colour, 3 legacy) with lays, fabric and dispatches`);

/* ── 5. Part 3 — inspections, defects and rework ─────────────────────────── */

const DEFECTS: [string, string][] = [
  ["Broken stitch", "STITCHING"], ["Skip stitch", "STITCHING"], ["Open seam", "STITCHING"],
  ["Puckering", "STITCHING"], ["Uneven hem", "STITCHING"],
  ["Print misalign", "PRINTING"], ["Print crack", "PRINTING"], ["Colour bleed", "PRINTING"],
  ["Fabric hole", "FABRIC"], ["Shade variation", "FABRIC"], ["Stain", "FABRIC"], ["Slub", "FABRIC"],
  ["Measurement out of tolerance", "MEASUREMENT"],
  ["Loose thread", "FINISHING"], ["Missing label", "FINISHING"], ["Wrong tag", "FINISHING"],
];
for (const [name, category] of DEFECTS) {
  await db.defectType.upsert({ where: { name }, create: { name, category: category as never }, update: {} });
}
const defectRows = await db.defectType.findMany({ select: { id: true, name: true } });
const defectByName = new Map(defectRows.map((d) => [d.name, d.id]));

const INSPECTIONS: [number, number, number, number, number, string[]][] = [
  // card index, checked, pass, reject, rework, defect names
  [0, 200, 196, 3, 1, ["Loose thread", "Broken stitch"]],
  [1, 150, 128, 14, 8, ["Shade variation", "Puckering", "Open seam"]],
  [2, 300, 291, 6, 3, ["Print misalign"]],
  [3, 100, 100, 0, 0, []],
  [6, 120, 108, 9, 3, ["Stain", "Skip stitch"]],
];
for (const [ci, checked, pass, reject, rework, names] of INSPECTIONS) {
  const card = cardIds[ci];
  if (!card) continue;
  await db.inspection.create({
    data: {
      jobCardId: card.id,
      inspectedById: admin?.id ?? null,
      at: ago(20 - ci),
      checkedQty: checked, passQty: pass, rejectQty: reject, reworkQty: rework,
      result: reject === 0 && rework === 0 ? "PASS" : pass === 0 ? "FAIL" : "PARTIAL",
      sampleSize: Math.round(checked / 4),
      defects: {
        create: names
          .map((n) => ({ defectTypeId: defectByName.get(n)!, qty: Math.max(1, Math.round(reject / names.length)) }))
          .filter((d) => d.defectTypeId != null),
      },
    },
  });
}

// One rework still out, one already back.
await db.rework.create({
  data: { docNo: "RW-2026-001", jobCardId: cardIds[1].id, vendorId: vendors[1].id, qty: 8, qtyBack: 0, status: "OPEN", at: ago(9), note: "shade variation panels" },
});
await db.rework.create({
  data: { docNo: "RW-2026-002", jobCardId: cardIds[0].id, vendorId: vendors[0].id, qty: 4, qtyBack: 4, status: "CLOSED", at: ago(30) },
});
console.log(`${DEFECTS.length} defect types, ${INSPECTIONS.length} inspections, 2 reworks`);

/* ── 6. Part 1 — payments, spread so the ageing buckets fill ─────────────── */

const PAYMENTS: [number, number, number, string][] = [
  // vendor index, amount, days ago, note
  [0, 18000, 8, "UPI 4471"],
  [0, 12000, 40, "cheque 100234"],
  [1, 9000, 15, "UPI 5512"],
  [3, 25000, 70, "NEFT"],
];
for (const [vi, amount, days, note] of PAYMENTS) {
  await db.partyLedgerEntry.create({
    data: { kind: "PAYMENT", direction: "CREDIT", amount, at: ago(days), vendorId: vendors[vi].id, note, createdById: admin?.id ?? null },
  });
}
await db.partyLedgerEntry.create({
  data: { kind: "ADVANCE", direction: "CREDIT", amount: 15000, at: ago(25), supplierId: suppliers[0].id, note: "advance against PO-2026-001", createdById: admin?.id ?? null },
});
await db.partyLedgerEntry.create({
  data: { kind: "PAYMENT", direction: "CREDIT", amount: 40000, at: ago(55), supplierId: suppliers[1].id, note: "part payment", createdById: admin?.id ?? null },
});
console.log(`${PAYMENTS.length + 2} ledger entries across vendors and suppliers`);

/* ── 7. Part 7 — samples at different stages ─────────────────────────────── */

const SAMPLES: [string, string, number, string, number | null][] = [
  ["SMP-2026-001", "Polo — navy, tipped collar", 2, "APPROVED", 749],
  ["SMP-2026-002", "Track pant — charcoal", 1, "SUBMITTED", 899],
  ["SMP-2026-003", "Round neck tee — white", 3, "REJECTED", 349],
];
for (let i = 0; i < SAMPLES.length; i++) {
  const [code, name, round, status, mrp] = SAMPLES[i];
  const s = await db.sample.create({
    data: {
      code, name, round, status: status as never,
      productId: products[i % products.length].id,
      vendorId: vendors[i % vendors.length].id,
      requestedById: admin?.id ?? null,
      targetMrp: mrp,
      notes: i === 0 ? "Buyer approved on the second round — collar tipping corrected." : null,
      remark: status === "REJECTED" ? "Neck rib too loose after wash" : status === "APPROVED" ? "Approved for bulk" : null,
      decidedAt: status === "APPROVED" || status === "REJECTED" ? ago(14 - i) : null,
      createdAt: ago(45 - i * 10),
      costLines: {
        create: [
          { kind: "FABRIC", description: "Body fabric", qty: 0.42, rate: 380 },
          { kind: "TRIM", description: "Collar + tipping", qty: 1, rate: 46 },
          { kind: "CUTTING", description: "Cutting", qty: 1, rate: 8 },
          { kind: "STITCHING", description: "Stitching", qty: 1, rate: 62 },
          { kind: "FINISHING", description: "Wash + press", qty: 1, rate: 18 },
          { kind: "OVERHEAD", description: "Overhead", qty: 1, rate: 25 },
        ],
      },
      measurements: {
        create: [
          ...["S", "M", "L", "XL"].map((size, k) => ({ pom: "Chest", size, valueCm: 48 + k * 2.5, tolerance: 1 })),
          ...["S", "M", "L", "XL"].map((size, k) => ({ pom: "Length", size, valueCm: 68 + k * 2, tolerance: 1 })),
          ...["S", "M", "L", "XL"].map((size, k) => ({ pom: "Sleeve", size, valueCm: 21 + k * 1, tolerance: 0.5 })),
        ],
      },
    },
  });
  void s;
}
console.log(`${SAMPLES.length} samples with cost sheets and measurement grids`);

/* ── 8. Part 2 — a few alerts so the bell is not empty ───────────────────── */

if (admin) {
  const NOTES: [string, string, number][] = [
    ["owner.digest", "Sport Sun — this morning\nCut 4,100 · dispatched 2,050 · 5 active\n3 job cards past ETD", 0],
    ["stock.low", "MAIN LABELS HEAT 4XL is at 120 — reorder level 500", 1],
    ["dispatch.done", "SI-01 — 600 pcs dispatched on DC-2026-001 · card closed", 2],
    ["challan.inward", "Received CH-IN-2026-004 — 1 line into stock", 3],
  ];
  for (const [template, body, days] of NOTES) {
    await db.notification.create({
      data: { template, body, to: "admin", channel: "INAPP", status: days === 0 ? "QUEUED" : "READ", at: ago(days), userId: admin.id },
    });
  }
  console.log(`${NOTES.length} notifications (1 unread)`);
}

/* ── done ────────────────────────────────────────────────────────────────── */

console.log("\n── what to look at ──");
console.log("  /                     payables + over-committed vendors + reorder");
console.log("  /job-cards/1          per-colour fabric, yield line, inspections");
console.log("  /job-cards/2          OVER-CUT: negative balance in red, rework out");
console.log("  /planning             one vendor over-committed against their ETD");
console.log("  /vendors/<name>/account   billed vs paid with ageing");
console.log("  /suppliers            on-time badges; open one for its scorecard");
console.log("  /trace                try LOT-4471 or DC-2026-001");
console.log("  /samples              one approved with a cost sheet and tech pack");
console.log("  /reports              quality by vendor, defects, fabric yield");
console.log("  /status               db size, last backup, replay keys\n");

await db.$disconnect();
