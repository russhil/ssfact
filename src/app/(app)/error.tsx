"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, Button, ButtonLink, EmptyState } from "@/components/ui";

/**
 * Change 25 Part B — the app's error boundary.
 *
 * Before this, a thrown server action or a failed render put a blank white page
 * on the floor with no way back except the browser's back button. `reset()`
 * re-renders the segment, which is enough to recover from a transient failure
 * (a locked SQLite write, a stale cache) without losing the session.
 *
 * The digest is the only handle onto the server-side stack trace — Next strips
 * the message in production — so it is shown deliberately, not hidden.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="p-6">
      <Card className="mx-auto max-w-xl p-2">
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title="This page failed to load"
          hint={error.message || undefined}
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={reset}>
                Try again
              </Button>
              <ButtonLink href="/">Dashboard</ButtonLink>
            </div>
          }
        />
        {error.digest && (
          <p className="pb-4 text-center font-mono t-xs text-faint">Ref {error.digest}</p>
        )}
      </Card>
    </div>
  );
}
