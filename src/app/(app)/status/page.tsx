import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader, Card, StatCard, DefList } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Change 36 Part 10 Part D — is this box healthy, and when was it last backed up? */
export default async function StatusPage() {
  const me = await getCurrentUser();
  if (me?.role !== "ADMIN") redirect("/");

  const dbPath = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
  let dbSize = 0;
  try { dbSize = statSync(dbPath).size; } catch { /* path differs in some deploys */ }

  let backups: { name: string; size: number; at: Date }[] = [];
  try {
    backups = readdirSync("backups")
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const s = statSync(join("backups", f));
        return { name: f, size: s.size, at: s.mtime };
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  } catch { /* no backups directory yet */ }

  const last = backups[0] ?? null;
  // Read the clock once, outside the render expression: Date.now() called inline is an
  // impure call during render, and this page is force-dynamic so one read per request is
  // exactly right.
  const now = new Date().getTime();
  const staleHours = last ? Math.round((now - last.at.getTime()) / 3600_000) : null;

  const [movements, cards, queued] = await Promise.all([
    db.stockMovement.count(),
    db.jobCard.count(),
    db.idempotencyRecord.count(),
  ]);

  return (
    <div className="p-6">
      <PageHeader title="Status" subtitle="This box" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Database" value={MB(dbSize)} foot={dbPath} />
        <StatCard
          label="Last backup"
          value={last ? fmtDate(last.at) : "never"}
          foot={staleHours == null ? "no backups found" : `${staleHours}h ago`}
          tone={staleHours == null || staleHours > 36 ? "danger" : undefined}
        />
        <StatCard label="Backups kept" value={String(backups.length)} foot={last ? MB(last.size) : "—"} />
        <StatCard label="Replay keys" value={String(queued)} foot="pruned after 30 days" />
      </div>

      <Card className="mt-3.5 p-4">
        <h3 className="mb-3 t-body font-bold">Data</h3>
        <DefList
          items={[
            { label: "Job cards", value: String(cards) },
            { label: "Stock movements", value: String(movements) },
            { label: "Health check", value: "/api/health" },
          ]}
        />
      </Card>

      <Card className="mt-3.5 p-4">
        <h3 className="mb-2 t-body font-bold">Restore</h3>
        <p className="t-sm text-t2">
          Backups are SQLite snapshots taken with <code>VACUUM INTO</code>, so each file is a complete database.
          The runbook is in <code>docs/RUNBOOK-RESTORE.md</code>.
        </p>
      </Card>
    </div>
  );
}
