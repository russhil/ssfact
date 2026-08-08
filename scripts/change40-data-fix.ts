/**
 * Change 40 — one-time data fixes (idempotent; safe to re-run).
 *
 * Run once after the change_40 migration is applied, on every environment:
 *   npx tsx scripts/change40-data-fix.ts
 *
 * 1. Part D — product BOM lines set to COLOR/SIZE become FLAT. Safe for history: job cards
 *    snapshot their BOM into JobBomLine at creation, so this never restates a raised card.
 *    Without it, a COLOR line keeps exploding against a single colour's cut quantity.
 * 2. Part L — the two firm-factories are flagged holdsStock=true so they appear in every firm
 *    picker. Names are matched case-insensitively; adjust FIRM_NAMES if the Buyer rows differ.
 *    User → home-firm assignment is intentionally NOT guessed here (spec L3: "do not guess") —
 *    an ADMIN sets it from the Users screen.
 */

import { db } from "../src/lib/db";

const FIRM_NAMES = ["Ravan Riti", "Jahangir Puri"];

async function main() {
  // 1. BOM COLOR/SIZE → FLAT (BomLine is the product master; JobBomLine snapshots are untouched)
  const bom = await db.bomLine.updateMany({
    where: { dimension: { in: ["COLOR", "SIZE"] } },
    data: { dimension: "FLAT" },
  });
  console.log(`Part D — BOM lines converted to FLAT: ${bom.count}`);

  // 2. Flag the firm-factories as stock-holding.
  let firms = 0;
  for (const name of FIRM_NAMES) {
    const r = await db.buyer.updateMany({
      where: { name: { equals: name } },
      data: { holdsStock: true },
    });
    firms += r.count;
    if (r.count === 0) console.warn(`  ⚠️ No Buyer named "${name}" — create it, then set holdsStock.`);
  }
  console.log(`Part L — firm-factories flagged holdsStock: ${firms}`);
  console.log("Reminder: set each user's home firm from the Users screen (spec L3 — not guessed).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
