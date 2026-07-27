/**
 * Change 25 Part L — is this purchase order late?
 *
 * Pure and dependency-free so the server selector (`getDelayedOrders`, which feeds
 * the dashboard widget) and the client row badges/filters on the two order lists
 * evaluate the SAME rule. "Delayed" therefore means exactly the same thing on the
 * dashboard, on the row, and in the filter — the standing requirement that a count
 * and the list it links to can never disagree.
 */

/** Open = not yet received and not abandoned. FabricOrderStatus, reused by TrimOrder. */
export const OPEN_ORDER_STATUSES = ["PLANNING", "SAMPLE_PENDING", "ORDER_PLACED"] as const;

export const isOpenOrder = (status: string) =>
  (OPEN_ORDER_STATUSES as readonly string[]).includes(status);

export type OrderFlag = "DELAYED" | "NO_ETA" | null;

/** Local midnight, so an order due today is not late until tomorrow. */
const startOfToday = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

export function orderFlag(
  o: { status: string; expectedDate: Date | string | null; poNumber: string | null },
  now: Date = new Date(),
): { flag: OrderFlag; daysLate: number } {
  if (!isOpenOrder(o.status)) return { flag: null, daysLate: 0 };

  const today = startOfToday(now);
  const due = o.expectedDate ? new Date(o.expectedDate) : null;

  if (due && due < today) {
    return { flag: "DELAYED", daysLate: Math.floor((today.getTime() - due.getTime()) / 86_400_000) };
  }
  // A PO went out but nobody logged an expected date, so there is nothing to track
  // it against. A draft with no PO raised yet is not flagged — nothing was promised.
  if (!due && o.poNumber) return { flag: "NO_ETA", daysLate: 0 };

  return { flag: null, daysLate: 0 };
}
