import { getSuppliers, listLookups } from "@/lib/masters";
import { getSupplierScores } from "@/lib/supplier-score";
import { PageHeader } from "@/components/ui";
import { SupplierManager } from "@/components/supplier-manager";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  // Change 36 Part 6 — one batched pass for every supplier's score, not one query each.
  const [suppliers, types, scores] = await Promise.all([
    getSuppliers(),
    listLookups("SUPPLIER_TYPE"),
    getSupplierScores(),
  ]);
  const scoreById = Object.fromEntries(scores.map((s) => [s.supplierId, s.onTimeRate]));
  return (
    <div className="p-6">
      <PageHeader title="Suppliers" subtitle="Supplier master for fabric and trims" />
      <SupplierManager suppliers={suppliers} types={types} onTimeById={scoreById} />
    </div>
  );
}
