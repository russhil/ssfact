import { getStyleOptions } from "@/lib/inventory";
import { StylesTable } from "@/components/styles-table";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StylesPage() {
  const styles = await getStyleOptions();
  return (
    <div className="p-6">
      <PageHeader
        title="Styles — Product Master"
        subtitle="Every style's MRP, fabric and average. Edit once here; every job card stays in sync."
      />
      <StylesTable styles={styles} />
    </div>
  );
}
