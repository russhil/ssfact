"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { discardDraftJobCard } from "@/lib/actions";
import { Badge, Card } from "@/components/ui";
import { num } from "@/lib/format";
import { Trash2 } from "lucide-react";
import type { DraftRow } from "@/lib/jobs";

/**
 * Change 38 Part A — job cards someone started and has not saved.
 *
 * Kept visibly apart from the production lists rather than mixed into them: a draft has cut
 * nothing, issued nothing and holds no SI number, so counting it anywhere would overstate
 * the floor. Discarding is a hard delete because a draft never posted — there is nothing to
 * reverse, which is exactly what makes it safe to bin without ceremony.
 */
export function DraftsStrip({ drafts }: { drafts: DraftRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  if (drafts.length === 0) return null;

  async function discard(d: DraftRow) {
    if (!confirm(`Discard "${d.label}"? It has posted nothing, so nothing is reversed.`)) return;
    setBusy(d.id);
    try {
      await discardDraftJobCard({ id: d.id });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <h3 className="mb-2 flex items-center gap-2 t-xs font-bold uppercase tracking-wide text-muted">
        Drafts <Badge tone="warn">{drafts.length}</Badge>
      </h3>
      <div className="divide-y divide-hairline">
        {drafts.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 py-2">
            <Link href={`/job-cards/new?draft=${d.id}`} className="min-w-0 flex-1 truncate t-sm font-semibold text-primary hover:underline">
              {d.label}
            </Link>
            <span className="flex items-center gap-3 t-xs text-faint">
              <span>{d.layers} lay{d.layers === 1 ? "" : "s"}</span>
              <span className="tnum">{num(d.cutQty)} pcs</span>
              <button
                type="button"
                onClick={() => discard(d)}
                disabled={busy === d.id}
                title="Discard this draft"
                className="text-faint transition hover:text-danger disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
