import "server-only";
import { getDashboard } from "@/lib/queries";
import { getLowStockAlerts, getDelayedOrders } from "@/lib/insights";
import { getPayables } from "@/lib/party-ledger";
import { num, inr } from "@/lib/format";

/**
 * Change 36 Part 2 Part C — the owner's one morning message.
 *
 * Composed strictly from the selectors that already drive the screens, never re-derived:
 * if the digest and the dashboard ever disagreed, the owner would stop trusting both.
 */
export async function buildOwnerDigest(): Promise<{ subject: string; body: string }> {
  const [{ kpis }, lowStock, delayed, payables] = await Promise.all([
    getDashboard(),
    getLowStockAlerts(),
    getDelayedOrders(),
    getPayables(),
  ]);

  const owed = payables.filter((p) => p.outstanding > 0);
  const totalOwed = owed.reduce((a, p) => a + p.outstanding, 0);
  const aged = owed.filter((p) => p.ageing.d90plus > 0).length;

  const lines = [
    `Cut ${num(kpis.totalCut)} · dispatched ${num(kpis.totalDispatched)} · ${num(kpis.activeJobs)} active`,
    kpis.overdue > 0 ? `${num(kpis.overdue)} job card${kpis.overdue === 1 ? "" : "s"} past ETD` : null,
    delayed.length > 0 ? `${num(delayed.length)} delayed purchase order${delayed.length === 1 ? "" : "s"}` : null,
    lowStock.length > 0 ? `${num(lowStock.length)} item${lowStock.length === 1 ? "" : "s"} at or below reorder level` : null,
    owed.length > 0
      ? `${inr(totalOwed)} outstanding across ${num(owed.length)} part${owed.length === 1 ? "y" : "ies"}${aged ? ` · ${num(aged)} over 90 days` : ""}`
      : null,
  ].filter(Boolean) as string[];

  return {
    subject: `Sport Sun — ${new Date().toDateString()}`,
    body: lines.join("\n"),
  };
}
