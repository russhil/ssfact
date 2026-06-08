import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import seed from "./seed.json";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const db = new PrismaClient({ adapter });

const d = (s: string | null | undefined) => (s ? new Date(s) : null);

async function main() {
  console.log("Clearing existing data…");
  await db.stockMovement.deleteMany();
  await db.dispatchEvent.deleteMany();
  await db.sizeBreakup.deleteMany();
  await db.jobCard.deleteMany();
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
    const v = await db.vendor.create({
      data: { name, kind: (src?.kind ?? "EXTERNAL") as any },
    });
    vendorMap.set(name, v.id);
  }

  // Cutting masters
  const cmMap = new Map<string, number>();
  for (const c of seed.cuttingMasters) {
    const r = await db.cuttingMaster.create({ data: { name: c.name } });
    cmMap.set(c.name, r.id);
  }

  // Fabrics
  const fabricMap = new Map<string, number>();
  for (const f of seed.fabrics) {
    const r = await db.fabric.create({
      data: { name: f.name, unit: f.unit as any, openingStock: f.openingStock },
    });
    fabricMap.set(f.name, r.id);
  }

  // Styles
  const styleMap = new Map<string, number>();
  for (const s of seed.styles) {
    const r = await db.style.create({
      data: {
        styleNo: s.styleNo,
        sku: s.sku,
        itemDesc: s.itemDesc,
        mrp: s.mrp,
        category: s.category,
        avgConsumption: s.avgConsumption,
        unit: s.unit as any,
        fabricId: s.fabric ? fabricMap.get(s.fabric) ?? null : null,
      },
    });
    styleMap.set(s.styleNo, r.id);
  }

  // Job cards (+ nested dispatches, size breakup, and a fabric ISSUE movement)
  let made = 0;
  for (const j of seed.jobCards) {
    const styleId = styleMap.get(j.styleNo);
    if (!styleId) continue;
    const vendorId = vendorMap.get(j.vendor) ?? vendorMap.get("Unassigned")!;
    const cuttingMasterId = j.cuttingMaster ? cmMap.get(j.cuttingMaster) ?? null : null;

    const issueQty = j.fabricConsumed ?? (j.cutQty && j.avgConsumption ? j.cutQty * j.avgConsumption : null);
    const fabricId = j.fabric ? fabricMap.get(j.fabric) ?? null : null;

    await db.jobCard.create({
      data: {
        siNo: j.siNo,
        orderDate: d(j.orderDate),
        cutQty: j.cutQty,
        dispatchedQty: j.dispatchedQty,
        avgConsumption: j.avgConsumption,
        fabricIssued: j.fabricIssued,
        fabricConsumed: j.fabricConsumed,
        fabricIssueDate: d(j.fabricIssueDate),
        cuttingIssuedOn: d(j.cuttingIssuedOn),
        plannedEtd: d(j.plannedEtd),
        status: j.status as any,
        remark: j.remark,
        styleId,
        vendorId,
        cuttingMasterId,
        dispatches: { create: j.dispatches.map((e: any) => ({ date: new Date(e.date), qty: e.qty })) },
        sizeBreakup: { create: j.sizeBreakup.map((s: any) => ({ size: s.size, qty: s.qty })) },
        movements:
          fabricId && issueQty
            ? {
                create: [
                  {
                    type: "ISSUE" as any,
                    qty: issueQty,
                    date: d(j.fabricIssueDate) ?? d(j.cuttingIssuedOn) ?? d(j.orderDate) ?? new Date(),
                    fabricId,
                  },
                ],
              }
            : undefined,
      },
    });
    made++;
  }

  console.log(
    `Seeded: ${vendorMap.size} vendors, ${cmMap.size} cutting masters, ` +
      `${fabricMap.size} fabrics, ${styleMap.size} styles, ${made} job cards.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
