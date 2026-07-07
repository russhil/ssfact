import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listLookups } from "@/lib/masters";
import { getCurrentUser } from "@/lib/auth";
import { ProductMasterForm } from "@/components/product-master-form";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const u = await getCurrentUser();
  const canEdit = u?.role === "ADMIN" || u?.role === "STAFF";
  if (!canEdit) notFound();
  const canSeeCost = u?.role === "ADMIN";
  const headCategories = await listLookups("HEAD_CATEGORY");

  return (
    <div className="p-6">
      <Link href="/catalog" className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Product Master
      </Link>
      <PageHeader
        title="New Product"
        subtitle="Add a style to the product master. Save first, then add colours, images and BOM on its page."
      />
      <ProductMasterForm mode="create" canSeeCost={canSeeCost} headCategories={headCategories} />
    </div>
  );
}
