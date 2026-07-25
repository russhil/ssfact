/**
 * Go-live reset — empty the factory's transaction history, keep the factory itself.
 *
 * The client accepted the tool loaded with historical/demo data imported from their
 * workbook and now wants to start booking real work from zero. What leaves is the *end
 * data*: what was cut, dispatched, ordered and moved. What stays is everything that
 * describes their factory and would be re-typed identically tomorrow — the product
 * catalog, fabric and trim masters, vendors, cutting masters, suppliers, the colour
 * master, the category taxonomy, and every login.
 *
 * Number series (SI-, PO-YYYY-NNN, POT-, DC-, CH-IN/OUT-) are derived in code from
 * max(existing) + 1, so they restart at 1 on their own once these tables are empty.
 * PRD-#### continues from the kept catalog, which is correct.
 *
 *   npm run db:wipe
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const db = new PrismaClient({ adapter });

/** Emptied — every one of these is a record of something that happened. */
const WIPED = [
  "ReturnNote", "DispatchLine", "DispatchEvent", "CuttingLayerCell", "CuttingLayer",
  "StitchReceipt", "StitchAssignment", "JobBomLine", "JobFabricLine", "SizeBreakup",
  "StockMovement", "MaterialChallanLine", "MaterialChallan", "JobCard", "TrimMovement",
  "FabricOrderLine", "FabricOrder", "TrimOrderLine", "TrimOrder", "FabricSupplier",
  "ProductionOrder", "Style",
] as const;

/** Kept — the client's own reference data. Counted before and after as proof. */
const KEPT = [
  "User", "Lookup", "Colour", "Vendor", "CuttingMaster", "Supplier",
  "Product", "ProductColor", "Bom", "BomLine", "Fabric", "FabricColor",
  "TrimItem", "ImageAsset",
] as const;

async function counts(tables: readonly string[]) {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [row] = await db.$queryRawUnsafe<{ n: number | bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`);
    out[t] = Number(row.n);
  }
  return out;
}

async function main() {
  const beforeWiped = await counts(WIPED);
  const beforeKept = await counts(KEPT);

  await db.$transaction(async (tx) => {
    // Children before parents. DispatchEvent also clears the implicit _DispatchLayers
    // join; FabricOrderLine/TrimOrderLine/CuttingLayerCell would cascade anyway, but
    // deleting them explicitly keeps this list readable as the full inventory of what goes.
    await tx.returnNote.deleteMany();
    await tx.dispatchLine.deleteMany();
    await tx.dispatchEvent.deleteMany();
    await tx.cuttingLayerCell.deleteMany();
    await tx.cuttingLayer.deleteMany();
    await tx.stitchReceipt.deleteMany();
    await tx.stitchAssignment.deleteMany();
    await tx.jobBomLine.deleteMany();
    await tx.jobFabricLine.deleteMany();
    await tx.sizeBreakup.deleteMany();
    await tx.stockMovement.deleteMany();
    await tx.materialChallanLine.deleteMany();
    await tx.materialChallan.deleteMany();
    await tx.jobCard.deleteMany();
    await tx.trimMovement.deleteMany();
    await tx.fabricOrderLine.deleteMany();
    await tx.fabricOrder.deleteMany();
    await tx.trimOrderLine.deleteMany();
    await tx.trimOrder.deleteMany();
    // Sourcing rates carry a poNumber + sourcedAt from a purchase order that no longer
    // exists — transaction residue, not a master link.
    await tx.fabricSupplier.deleteMany();
    await tx.productionOrder.deleteMany();
    // Dead legacy model, superseded by Product. No FK from Product; /styles redirects
    // to /catalog.
    await tx.style.deleteMany();

    // Stock is an authoritative snapshot, not a sum over the ledger — deleting the
    // movements above does NOT zero it. It has to be set explicitly.
    await tx.fabric.updateMany({ data: { openingStock: 0 } });
    await tx.fabricColor.updateMany({ data: { openingStock: 0, currentStock: 0 } });
    await tx.trimItem.updateMany({ data: { openingStock: 0, currentStock: 0 } });
  });

  const afterWiped = await counts(WIPED);
  const afterKept = await counts(KEPT);

  const [stockLeft] = await db.$queryRawUnsafe<{ f: number | bigint; t: number | bigint }[]>(
    `SELECT (SELECT COUNT(*) FROM "FabricColor" WHERE currentStock != 0 OR openingStock != 0) AS f,
            (SELECT COUNT(*) FROM "TrimItem"   WHERE currentStock != 0 OR openingStock != 0) AS t`
  );

  const pad = (s: string) => s.padEnd(22);
  console.log("\nWIPED");
  for (const t of WIPED) console.log(`  ${pad(t)} ${String(beforeWiped[t]).padStart(6)} → ${afterWiped[t]}`);
  console.log("\nKEPT");
  for (const t of KEPT) console.log(`  ${pad(t)} ${String(beforeKept[t]).padStart(6)} → ${afterKept[t]}`);
  console.log(`\nStock rows still non-zero: ${Number(stockLeft.f)} fabric colours, ${Number(stockLeft.t)} trims`);

  const leftovers = WIPED.filter((t) => afterWiped[t] !== 0);
  const lost = KEPT.filter((t) => afterKept[t] !== beforeKept[t]);
  if (leftovers.length) throw new Error(`Not emptied: ${leftovers.join(", ")}`);
  if (lost.length) throw new Error(`Master data changed unexpectedly: ${lost.join(", ")}`);
  if (Number(stockLeft.f) || Number(stockLeft.t)) throw new Error("Stock counters were not fully zeroed");

  await db.$executeRawUnsafe("VACUUM");
  console.log("\nClean. Every series restarts at 1 on the next document.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
