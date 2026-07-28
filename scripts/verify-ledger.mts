/**
 * Change 37 — the fabric ledger regression net.
 *
 * This repo has no test framework, and Change 37 rewrites how stock is posted. Run this
 * against a snapshot BEFORE the change and AFTER it: historical numbers must be
 * byte-identical, because legacy layers (no colour rows) still take the old proportional
 * path. Treat a FAIL as a blocker, not a warning.
 *
 *   npm run verify:ledger
 *
 * Checks, in order of how much they would hurt if broken:
 *   1. Stock integrity   — FabricColor.currentStock == opening + ΣRECEIPT − ΣISSUE
 *   2. Card reconciliation — ledger net per (fabric, job, colour) == JobFabricLine.qtyUsed
 *   3. Layer totals       — fabricMtr/fabricIssued == Σ of the layer's colour rows
 *   4. No double-posting  — a layer is on exactly one path, colour-rows or split
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

const key = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.011; // one paisa of rounding slack

let failures = 0;
const fail = (check: string, detail: string) => { failures++; console.log(`  FAIL [${check}] ${detail}`); };

/* 1 ─ stock integrity ------------------------------------------------------ */
{
  const colours = await db.fabricColor.findMany({
    select: { id: true, color: true, openingStock: true, currentStock: true, fabricId: true, fabric: { select: { name: true } } },
  });
  const moves = await db.stockMovement.groupBy({
    by: ["fabricId", "color", "type"],
    _sum: { qty: true },
  });
  const net = new Map<string, number>();
  for (const m of moves) {
    const k = `${m.fabricId}|${key(m.color)}`;
    const signed = (m._sum.qty ?? 0) * (m.type === "RECEIPT" ? 1 : -1);
    net.set(k, (net.get(k) ?? 0) + signed);
  }
  let checked = 0;
  for (const c of colours) {
    const expected = r2(c.openingStock + (net.get(`${c.fabricId}|${key(c.color)}`) ?? 0));
    checked++;
    if (!near(expected, c.currentStock)) {
      fail("stock", `${c.fabric.name} · ${c.color}: currentStock ${c.currentStock} but opening+movements = ${expected}`);
    }
  }
  console.log(`1. Stock integrity — ${checked} (fabric, colour) rows checked`);
}

/* 2 ─ card reconciliation -------------------------------------------------- */
{
  const lines = await db.jobFabricLine.findMany({
    select: { jobCardId: true, fabricId: true, color: true, qtyUsed: true, jobCard: { select: { siNo: true } } },
  });
  const moves = await db.stockMovement.groupBy({
    by: ["fabricId", "jobCardId", "color", "type"],
    where: { jobCardId: { not: null } },
    _sum: { qty: true },
  });
  const net = new Map<string, number>();
  for (const m of moves) {
    const k = `${m.fabricId}|${m.jobCardId}|${key(m.color)}`;
    const signed = (m._sum.qty ?? 0) * (m.type === "ISSUE" ? 1 : -1);
    net.set(k, (net.get(k) ?? 0) + signed);
  }
  let reconciled = 0, unrecorded = 0;
  for (const l of lines) {
    // qtyUsed null = actuals never recorded for that colour; the net is still the issue
    // estimate and there is nothing to reconcile against yet. Not a failure.
    if (l.qtyUsed == null) { unrecorded++; continue; }
    const posted = r2(net.get(`${l.fabricId}|${l.jobCardId}|${key(l.color)}`) ?? 0);
    reconciled++;
    if (!near(posted, l.qtyUsed)) {
      fail("reconcile", `${l.jobCard.siNo} · ${l.color}: ledger net ${posted} but qtyUsed ${l.qtyUsed}`);
    }
  }
  console.log(`2. Card reconciliation — ${reconciled} colour lines with actuals checked (${unrecorded} awaiting actuals)`);
}

/* 3 ─ layer totals == Σ colour rows --------------------------------------- */
{
  const layers = await db.cuttingLayer.findMany({
    where: { colours: { some: {} } },
    select: {
      id: true, layerNo: true, fabricMtr: true, fabricIssued: true,
      colours: { select: { colour: true, fabricIssued: true, fabricUsed: true } },
      jobCard: { select: { siNo: true } },
    },
  });
  const sum = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? r2(v.reduce((a, b) => a + b, 0)) : null;
  };
  for (const l of layers) {
    const used = sum(l.colours.map((c) => c.fabricUsed));
    const iss = sum(l.colours.map((c) => c.fabricIssued));
    if (used != null && l.fabricMtr != null && !near(used, l.fabricMtr)) {
      fail("layer-total", `${l.jobCard.siNo} layer ${l.layerNo}: fabricMtr ${l.fabricMtr} but colour rows sum to ${used}`);
    }
    if (iss != null && l.fabricIssued != null && !near(iss, l.fabricIssued)) {
      fail("layer-total", `${l.jobCard.siNo} layer ${l.layerNo}: fabricIssued ${l.fabricIssued} but colour rows sum to ${iss}`);
    }
  }
  console.log(`3. Layer totals — ${layers.length} layers with colour rows checked`);
}

/* 4 ─ one path per layer --------------------------------------------------- */
{
  const total = await db.cuttingLayer.count();
  const withRows = await db.cuttingLayer.count({ where: { colours: { some: {} } } });
  const dupes = await db.cuttingLayerColour.groupBy({
    by: ["layerId", "colour"],
    _count: { _all: true },
    having: { colour: { _count: { gt: 1 } } },
  });
  for (const d of dupes) fail("double-post", `layer ${d.layerId} has ${d._count._all} rows for colour ${d.colour}`);
  console.log(`4. Path split — ${withRows} per-colour layers, ${total - withRows} legacy layers on the proportional split`);
}

console.log(failures === 0 ? "\nPASS — ledger reconciles" : `\nFAIL — ${failures} problem(s)`);
await db.$disconnect();
process.exit(failures === 0 ? 0 : 1);
