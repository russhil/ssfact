import { Card, Skeleton } from "@/components/ui";

/**
 * Change 25 Part B — navigation placeholder.
 *
 * Every page is `force-dynamic` with server-side queries, so a click used to
 * freeze the current screen until the next one was ready. This shape (title,
 * KPI strip, table) is the one most screens resolve into, so the swap reads as
 * the page arriving rather than as a different layout replacing it.
 */
export default function AppLoading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-2 h-7 w-52" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[5.5rem]" />
        ))}
      </div>
      <Card className="p-5">
        <Skeleton className="mb-4 h-8 w-full" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
