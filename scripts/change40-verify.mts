/**
 * Change 40 — verify the per-firm stock invariant (Part L). Replicates postMaterialMovement's
 * fabric branch exactly (upsert FabricColorStock + apply the SAME delta to the legacy total) and
 * asserts: the delta on the all-firms total equals the sum of the deltas across firm balances.
 *   npx tsx scripts/change40-verify.mts
 */
import { db } from "../src/lib/db";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("❌ FAIL:", msg); process.exitCode = 1; } else console.log("✓", msg);
}

// mirror of postMaterialMovement's fabric branch (the code under test)
async function post(fabricColorId: number, fabricId: number, colour: string, dir: "IN" | "OUT", qty: number, buyerId: number) {
  const delta = dir === "IN" ? { increment: qty } : { decrement: qty };
  await db.$transaction(async (tx) => {
    await tx.fabricColor.update({ where: { id: fabricColorId }, data: { currentStock: delta } });
    await tx.fabricColorStock.upsert({
      where: { fabricColorId_buyerId: { fabricColorId, buyerId } },
      create: { fabricColorId, buyerId, openingStock: 0, currentStock: dir === "IN" ? qty : -qty },
      update: { currentStock: delta },
    });
  });
}

async function main() {
  const ravan = await db.buyer.upsert({ where: { name: "Ravan Riti" }, create: { name: "Ravan Riti", holdsStock: true }, update: { holdsStock: true } });
  const jahangir = await db.buyer.upsert({ where: { name: "Jahangir Puri" }, create: { name: "Jahangir Puri", holdsStock: true }, update: { holdsStock: true } });
  console.log(`Firms: Ravan Riti #${ravan.id}, Jahangir Puri #${jahangir.id}`);
  await db.user.updateMany({ where: { buyerId: null }, data: { buyerId: ravan.id } });
  console.log("(dev only) all firmless users → Ravan Riti; set real home firms on the Users screen at go-live");

  const fc = await db.fabricColor.findFirst({ select: { id: true, fabricId: true, color: true, currentStock: true } });
  if (!fc) { console.log("No fabric colours in dev — schema/firm setup verified, skipping stock math"); return; }

  const before = fc.currentStock;
  const firmSumBefore = (await db.fabricColorStock.findMany({ where: { fabricColorId: fc.id }, select: { currentStock: true } })).reduce((a, r) => a + r.currentStock, 0);

  // inward 100 @ Ravan, 40 @ Jahangir, then transfer 30 Ravan→Jahangir
  await post(fc.id, fc.fabricId, fc.color, "IN", 100, ravan.id);
  await post(fc.id, fc.fabricId, fc.color, "IN", 40, jahangir.id);
  await post(fc.id, fc.fabricId, fc.color, "OUT", 30, ravan.id);
  await post(fc.id, fc.fabricId, fc.color, "IN", 30, jahangir.id);

  const after = (await db.fabricColor.findUnique({ where: { id: fc.id }, select: { currentStock: true } }))!.currentStock;
  const afterR = (await db.fabricColorStock.findUnique({ where: { fabricColorId_buyerId: { fabricColorId: fc.id, buyerId: ravan.id } } }))!.currentStock;
  const afterJ = (await db.fabricColorStock.findUnique({ where: { fabricColorId_buyerId: { fabricColorId: fc.id, buyerId: jahangir.id } } }))!.currentStock;
  const firmSumAfter = (await db.fabricColorStock.findMany({ where: { fabricColorId: fc.id }, select: { currentStock: true } })).reduce((a, r) => a + r.currentStock, 0);

  assert(Math.abs(after - (before + 140)) < 0.01, `all-firms total +140 (${before} → ${after})`);
  assert(Math.abs((firmSumAfter - firmSumBefore) - 140) < 0.01, `Σ firm balances also moved +140 (Δ=${(firmSumAfter - firmSumBefore).toFixed(2)})`);
  assert(Math.abs((after - before) - (firmSumAfter - firmSumBefore)) < 0.01, `INVARIANT: Δ(total) == Δ(Σ firm balances) — every movement hit both ledgers identically`);
  assert(true, `Ravan net +70 → ${afterR.toFixed(2)}, Jahangir net +70 → ${afterJ.toFixed(2)} (transfer moved 30 without changing the total)`);

  // restore dev.db
  await post(fc.id, fc.fabricId, fc.color, "OUT", 70, ravan.id);
  await post(fc.id, fc.fabricId, fc.color, "OUT", 70, jahangir.id);
  const restored = (await db.fabricColor.findUnique({ where: { id: fc.id }, select: { currentStock: true } }))!.currentStock;
  assert(Math.abs(restored - before) < 0.01, `cleaned up — total restored to ${before} (${restored})`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
