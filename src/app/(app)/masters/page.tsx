import { PageHeader } from "@/components/ui";
import { getCategoryTree, listLookupsAll, getColours } from "@/lib/masters";
import { MastersTabs } from "@/components/masters/masters-tabs";

export const dynamic = "force-dynamic";

export default async function MastersPage() {
  const [tree, units, supplierTypes, trimCategories, styleGroups, colours] = await Promise.all([
    getCategoryTree(),
    listLookupsAll("UNIT"),
    listLookupsAll("SUPPLIER_TYPE"),
    listLookupsAll("TRIM_CATEGORY"),
    listLookupsAll("STYLE_GROUP"),
    getColours(),
  ]);

  return (
    <div className="p-6">
      <PageHeader title="Masters" subtitle="One place to manage every reusable dropdown list — add, rename or deactivate. Renaming keeps a stable key, so existing records stay valid." />
      <MastersTabs tree={tree} units={units} supplierTypes={supplierTypes} trimCategories={trimCategories} styleGroups={styleGroups} colours={colours} />
    </div>
  );
}
