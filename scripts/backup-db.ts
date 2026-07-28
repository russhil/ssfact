/**
 * Change 25 Part C — the backup CLI. All the work is in src/lib/backup.ts so this
 * and the on-demand download button in /settings run the same code.
 *
 *   npm run backup
 *   BACKUP_DIR=/mnt/backups BACKUP_KEEP=30 npm run backup
 *
 * Nightly cron (documented in README):
 *   0 2 * * * cd /srv/ssfact && /usr/bin/npm run backup >> /var/log/ssfact-backup.log 2>&1
 *
 * ── Change 36 Part 10 Part D ──
 * A backup that lives on the same disk as the database is not a backup: it survives a
 * mistake, not a dead box. Set BACKUP_REMOTE to an rclone remote and each snapshot is
 * copied off-box straight after it is written.
 *
 *   BACKUP_REMOTE=b2:ssfact-backups npm run backup
 *
 * A copy failure is reported but does NOT fail the run — a local backup that exists beats
 * no backup because the network was down.
 *
 * This also prunes the Part 10 replay keys, which would otherwise grow forever.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createBackup } from "../src/lib/backup";
import { pruneIdempotency } from "../src/lib/idempotency";

const r = createBackup();
console.log(`${r.file}  ${(r.size / 1_048_576).toFixed(1)} MB`);
if (r.pruned.length) console.log(`pruned ${r.pruned.length}: ${r.pruned.join(", ")}`);

const remote = process.env.BACKUP_REMOTE;
if (remote) {
  try {
    execFileSync("rclone", ["copy", r.file, remote, "--no-traverse"], { stdio: "pipe" });
    console.log(`copied off-box → ${remote}`);
  } catch (e) {
    console.error(`OFF-BOX COPY FAILED → ${remote}: ${e instanceof Error ? e.message : String(e)}`);
    console.error("the local snapshot is still good; fix the remote and re-run");
  }
} else {
  console.log("BACKUP_REMOTE not set — this snapshot exists only on this box");
}

const keys = await pruneIdempotency(30);
if (keys) console.log(`pruned ${keys} replay key(s) older than 30 days`);
