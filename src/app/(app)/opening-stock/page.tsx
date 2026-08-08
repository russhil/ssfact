import { db } from "@/lib/db";
import { listFirms } from "@/lib/firm-scope";
import { OpeningStockForm } from "@/components/opening-stock-form";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OpeningStockPage() {
  await requireRole("ADMIN"); // Change 40 L10 — opening balances are an admin go-live task
  const [firms, fabricColors, trims] = await Promise.all([
    listFirms(),
    db.fabricColor.findMany({
      orderBy: [{ fabric: { name: "asc" } }, { color: "asc" }],
      select: { id: true, color: true, fabric: { select: { name: true } } },
    }),
    db.trimItem.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <OpeningStockForm
      firms={firms}
      fabricColors={fabricColors.map((fc) => ({ id: fc.id, label: `${fc.fabric?.name ?? "—"} · ${fc.color}` }))}
      trims={trims}
    />
  );
}
