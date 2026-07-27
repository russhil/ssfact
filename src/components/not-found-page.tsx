import { FileQuestion } from "lucide-react";
import { Card, ButtonLink, EmptyState } from "@/components/ui";

/**
 * Change 25 Part B — the body of every `not-found.tsx`.
 *
 * The document routes (/po, /challan-doc, …) render outside the (app) group and
 * have no sidebar, so this has to stand on its own rather than assume the shell.
 */
export function NotFoundPage({
  what,
  backHref,
  backLabel,
}: {
  /** The record that wasn't there, e.g. "job card". */
  what: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="p-6">
      <Card className="mx-auto max-w-xl p-2">
        <EmptyState
          icon={<FileQuestion size={24} />}
          title={`No such ${what}`}
          action={<ButtonLink href={backHref}>{backLabel}</ButtonLink>}
        />
      </Card>
    </div>
  );
}
