"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, Badge, SortHeader, TableToolbar, useTableView, type FilterDef } from "@/components/ui";
import { AuditDiff, summarizeAudit, actionTone } from "@/components/audit-diff";
import type { AuditRow } from "@/lib/masters";

/**
 * Change 25 Part A — who did what, when.
 *
 * Row shape follows azadi's audit page: timestamp · one plain sentence · action
 * pill, click to expand into the before/after diff. Filtering rides the Change 23
 * toolbar rather than azadi's bespoke filter bar + server pagination, so this page
 * behaves like every other table in the app.
 */

/** Where an audited row lives, so the log links back to the thing that changed. */
function entityHref(row: AuditRow): string | null {
  const jobCardId = (row.meta?.jobCardId as number | undefined) ?? null;
  switch (row.entity) {
    case "JobCard":
      return row.action === "deleteJobCard" ? null : `/job-cards/${row.entityId}`;
    case "DispatchEvent":
      return `/dispatch-doc/${row.entityId}`;
    case "MaterialChallan":
      return `/challan-doc/${row.entityId}`;
    case "CuttingLayer":
      return jobCardId ? `/job-cards/${jobCardId}` : null;
    case "FabricColor":
      return row.meta?.fabricId ? `/inventory/${row.meta.fabricId}` : null;
    case "TrimItem":
      return `/trims/${row.entityId}`;
    case "FabricOrder":
      return "/fabric-orders";
    case "TrimOrder":
      return "/trim-orders";
    case "Supplier":
      return "/suppliers";
    default:
      return null;
  }
}

const ts = (d: Date | string) =>
  new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function AuditLog({
  rows,
  options,
}: {
  rows: AuditRow[];
  options: { actions: string[]; entities: string[]; users: string[] };
}) {
  const [open, setOpen] = useState<string | null>(null);

  const filters: FilterDef<AuditRow>[] = useMemo(
    () => [
      {
        key: "action",
        label: "actions",
        options: options.actions.map((a) => ({ value: a, label: a })),
        match: (r, v) => r.action === v,
      },
      {
        key: "entity",
        label: "records",
        options: options.entities.map((e) => ({ value: e, label: e })),
        match: (r, v) => r.entity === v,
      },
      {
        key: "user",
        label: "users",
        options: options.users.map((u) => ({ value: u, label: u })),
        match: (r, v) => r.username === v,
      },
    ],
    [options]
  );

  const view = useTableView<AuditRow>({
    id: "aud",
    rows,
    filters,
    search: (r) => [r.username, r.action, r.entity, r.entityId, r.entityLabel, r.summary],
    date: (r) => r.at,
    sorts: {
      at: (r) => new Date(r.at),
      user: (r) => r.username,
      action: (r) => r.action,
      entity: (r) => r.entity,
    },
    defaultSort: { key: "at", dir: "desc" },
  });

  return (
    <Card className="p-5">
      <TableToolbar
        view={view}
        filters={filters}
        searchPlaceholder="Search user, record, document no…"
        dateLabel="Changed"
      />
      <div className="overflow-x-auto">
        <table className="w-full t-sm">
          <thead>
            <tr className="border-b border-border text-left t-xs uppercase tracking-wide text-faint">
              <th className="w-6 px-2 py-2.5"></th>
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="at">When</SortHeader></th>
              <th className="px-3 py-2.5 font-semibold">What happened</th>
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="entity">Record</SortHeader></th>
              <th className="px-3 py-2.5"><SortHeader view={view} sortKey="action">Action</SortHeader></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const expanded = open === r.id;
              const detail = !!(r.changes || r.meta);
              const href = entityHref(r);
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => detail && setOpen(expanded ? null : r.id)}
                    className={`border-b border-hairline last:border-0 ${detail ? "cursor-pointer hover:bg-surface-2" : ""}`}
                  >
                    <td className="px-2 py-2.5 text-faint">
                      {detail && (
                        <ChevronRight
                          size={13}
                          className={`transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-t3 tnum">{ts(r.at)}</td>
                    <td className="px-3 py-2.5 text-t1">{summarizeAudit(r)}</td>
                    <td className="px-3 py-2.5 text-t2">
                      {href ? (
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold text-primary-ink hover:underline"
                        >
                          {r.entityLabel ?? `${r.entity} #${r.entityId}`}
                        </Link>
                      ) : (
                        <span>{r.entityLabel ?? `${r.entity} #${r.entityId}`}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={actionTone(r.action)}>{r.action}</Badge>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-hairline last:border-0">
                      <td colSpan={5} className="px-3 pb-4 pt-1 md:px-12">
                        <AuditDiff row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {view.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center t-sm text-faint">
                  Nothing recorded in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
