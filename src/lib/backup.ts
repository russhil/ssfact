import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Change 25 Part C — SQLite backup.
 *
 * `VACUUM INTO` is the only correct way to copy a live SQLite database: it takes a
 * read transaction, so the copy is a consistent snapshot even mid-write, and it
 * compacts as it goes. A raw `cp` of a database with a hot WAL can produce a file
 * that will not open — do not "simplify" this to a file copy.
 *
 * Runs through better-sqlite3, already a dependency, rather than shelling out to a
 * `sqlite3` binary that isn't guaranteed to exist on the host.
 *
 * Lives in lib rather than in the script so the nightly cron and the on-demand
 * download button run exactly the same code.
 */

const PREFIX = "ssfact-";
const SUFFIX = ".sqlite";
const DEFAULT_KEEP = 14;

/** `file:./dev.db` / `file:/abs/path.db` → an absolute filesystem path. */
export function dbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return resolve(raw.split("?")[0]);
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** Delete all but the newest `keep` backups. Returns what it removed. */
function prune(dir: string, keep: number): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const doomed = files.slice(keep).map((x) => x.f);
  for (const f of doomed) unlinkSync(join(dir, f));
  return doomed;
}

export type BackupResult = { file: string; name: string; size: number; pruned: string[] };

export function createBackup(opts?: { dir?: string; keep?: number }): BackupResult {
  const src = dbPath();
  if (!existsSync(src)) throw new Error(`No database at ${src} — check DATABASE_URL`);

  const dir = resolve(opts?.dir ?? process.env.BACKUP_DIR ?? "backups");
  const keep = opts?.keep ?? Number(process.env.BACKUP_KEEP ?? DEFAULT_KEEP);
  mkdirSync(dir, { recursive: true });

  // Minute resolution keeps the filename readable; two runs inside one minute (the
  // on-demand button clicked twice) get a seconds suffix rather than an error.
  const now = new Date();
  let name = `${PREFIX}${stamp(now)}${SUFFIX}`;
  if (existsSync(join(dir, name))) {
    name = `${PREFIX}${stamp(now)}-${String(now.getSeconds()).padStart(2, "0")}${SUFFIX}`;
  }
  const file = join(dir, name);

  const db = new Database(src, { readonly: true });
  try {
    // VACUUM INTO takes a string literal, not a bound parameter.
    db.prepare(`VACUUM INTO '${file.replace(/'/g, "''")}'`).run();
  } finally {
    db.close();
  }

  return { file, name, size: statSync(file).size, pruned: prune(dir, keep) };
}
