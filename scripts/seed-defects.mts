/**
 * Change 36 Part 3 — the defect list a garment floor actually calls out, by the name it
 * uses. Idempotent: re-running adds nothing. Owner-managed thereafter.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

const SEED: [string, string][] = [
  ["Broken stitch", "STITCHING"], ["Skip stitch", "STITCHING"], ["Open seam", "STITCHING"],
  ["Puckering", "STITCHING"], ["Uneven hem", "STITCHING"],
  ["Print misalign", "PRINTING"], ["Print crack", "PRINTING"], ["Colour bleed", "PRINTING"],
  ["Fabric hole", "FABRIC"], ["Shade variation", "FABRIC"], ["Stain", "FABRIC"], ["Slub", "FABRIC"],
  ["Measurement out of tolerance", "MEASUREMENT"],
  ["Loose thread", "FINISHING"], ["Missing label", "FINISHING"], ["Wrong tag", "FINISHING"],
];

for (const [name, category] of SEED) {
  await db.defectType.upsert({
    where: { name },
    create: { name, category: category as never },
    update: {},
  });
}
console.log(`seeded — ${await db.defectType.count()} defect types`);
await db.$disconnect();
