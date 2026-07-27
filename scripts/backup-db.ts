/**
 * Change 25 Part C — the backup CLI. All the work is in src/lib/backup.ts so this
 * and the on-demand download button in /settings run the same code.
 *
 *   npm run backup
 *   BACKUP_DIR=/mnt/backups BACKUP_KEEP=30 npm run backup
 *
 * Nightly cron (documented in README):
 *   0 2 * * * cd /srv/ssfact && /usr/bin/npm run backup >> /var/log/ssfact-backup.log 2>&1
 */
import "dotenv/config";
import { createBackup } from "../src/lib/backup";

const r = createBackup();
console.log(`${r.file}  ${(r.size / 1_048_576).toFixed(1)} MB`);
if (r.pruned.length) console.log(`pruned ${r.pruned.length}: ${r.pruned.join(", ")}`);
