/**
 * Change 38 Part A — the line between a card that has posted and one that has not.
 *
 * A DRAFT job card is inert: it moved no stock, wrote no ledger row, planned no trims and
 * raised no challan. So it must never reach anything that counts production — the board,
 * dashboard KPIs, capacity, yield, on-time delivery, quality, margins, the vendor statement
 * or a delete-guard reference count. A draft silently inflating a KPI is the failure mode
 * this file exists to prevent, and it is a quiet failure: nothing errors, the number is just
 * wrong.
 *
 * Spread POSTED into a JobCard `where` rather than writing `status: { not: "DRAFT" }` by
 * hand, so every exclusion site is greppable from one place.
 *
 *   where: { ...POSTED, vendorId }
 *
 * Queries already scoped to `status: "ACTIVE"` (capacity, my-work, the nav badge) exclude
 * drafts for free and are deliberately left alone.
 *
 * ⚠️ `src/lib/jobs.ts` is classified as binary by grep — it holds getJobs, the highest
 * traffic JobCard query of the lot. Use `grep -a` when auditing this.
 */

/** JobCard rows that have actually posted. The default scope for anything that counts. */
export const POSTED = { status: { not: "DRAFT" as const } };

/** Only drafts — the Drafts strip on the board, the job list and the dashboard. */
export const DRAFTS_ONLY = { status: "DRAFT" as const };

/**
 * The same line for purchase orders. FabricOrder and TrimOrder share FabricOrderStatus, so
 * one constant covers both.
 */
export const POSTED_ORDER = { status: { not: "DRAFT" as const } };

/**
 * How a draft names itself before it has an SI number.
 *
 * A draft takes its SI only on save, so it has no identifier to show. Falling back to a
 * blank cell reads as a broken row; say what the card is instead, and say plainly when
 * nothing has been typed yet.
 */
export function draftLabel(card: { item?: string | null; vendor?: string | null }) {
  const parts = [card.item?.trim(), card.vendor?.trim()].filter(Boolean);
  return parts.length ? `Draft · ${parts.join(" · ")}` : "Draft · nothing entered yet";
}
