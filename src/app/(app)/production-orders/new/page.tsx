import { getProductOptions } from "@/lib/production";
import { NewOrderForm } from "@/components/new-order-form";

export const dynamic = "force-dynamic";

export default async function NewProductionOrderPage() {
  const products = await getProductOptions();
  return (
    <div className="p-6">
      <NewOrderForm products={products} />
    </div>
  );
}
