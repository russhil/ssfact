import { requireRole } from "@/lib/auth";
import { getPayables } from "@/lib/party-ledger";
import { csvCell, ymd } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change 36 Part 1 — the Tally export.
 *
 * ssfact does not keep the books; Tally does. This hands over the operational position
 * — who is owed what, and how old it is — in a shape Tally's import can read, so the
 * two never have to be reconciled by hand.
 *
 * Owner-only: this is the whole payables position of the factory in one file.
 */
const COLUMNS = [
  "Party", "Type", "Billed", "Paid", "Outstanding",
  "0-30", "31-60", "61-90", "90+",
] as const;

export async function GET() {
  await requireRole("ADMIN");
  const rows = await getPayables();

  const body = [
    COLUMNS.join(","),
    ...rows.map((s) =>
      [
        csvCell(s.name),
        csvCell(s.kind === "VENDOR" ? "Vendor" : "Supplier"),
        s.billed.toFixed(2),
        s.paid.toFixed(2),
        s.outstanding.toFixed(2),
        s.ageing.d0_30.toFixed(2),
        s.ageing.d31_60.toFixed(2),
        s.ageing.d61_90.toFixed(2),
        s.ageing.d90plus.toFixed(2),
      ].join(",")
    ),
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payables-${ymd(new Date())}.csv"`,
    },
  });
}
