import { readFileSync } from "node:fs";
import { requireRole } from "@/lib/auth";
import { createBackup } from "@/lib/backup";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Change 25 Part C — take a backup now and hand it over.
 *
 * Same `createBackup()` the nightly cron runs, so the file the owner downloads
 * before a risky change is byte-identical in kind to the scheduled ones, and it
 * lands in the same rotation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireRole("ADMIN");

  const r = createBackup();
  const body = readFileSync(r.file);

  await logAudit(db, user, {
    action: "downloadBackup",
    entity: "Backup",
    entityId: r.name,
    entityLabel: r.name,
    summary: `Downloaded a database backup (${(r.size / 1_048_576).toFixed(1)} MB)`,
    meta: { size: r.size, pruned: r.pruned },
  });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${r.name}"`,
      "Content-Length": String(r.size),
      "Cache-Control": "no-store",
    },
  });
}
