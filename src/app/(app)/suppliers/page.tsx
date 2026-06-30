import { getSuppliers, listLookups } from "@/lib/masters";
import { PageHeader } from "@/components/ui";
import { SupplierManager } from "@/components/supplier-manager";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const [suppliers, types] = await Promise.all([getSuppliers(), listLookups("SUPPLIER_TYPE")]);
  return (
    <div className="p-6">
      <PageHeader title="Suppliers" subtitle="Shared supplier master for fabric orders and every trim category. Add, edit or deactivate — old records keep resolving." />
      <SupplierManager suppliers={suppliers} types={types} />
    </div>
  );
}
