# Restore runbook

*Change 36 Part 10 Part D.* Written to be followed by someone who did not write the app,
at a bad moment. Every command is copy-pasteable.

## What a backup is

`npm run backup` takes a SQLite snapshot with `VACUUM INTO`. That produces a **complete,
self-contained database file** — not a diff and not a dump needing replay. Restoring is a
file copy.

Snapshots land in `backups/` (override with `BACKUP_DIR`) and are named by timestamp.
With `BACKUP_REMOTE` set, each one is also copied off-box via rclone.

## Check before you touch anything

```bash
curl -fsS http://127.0.0.1:3100/api/health   # {"ok":true,"db":"up"} when healthy
sudo systemctl status ssfact                  # is the process even running?
ls -lht backups/ | head                       # newest snapshot first
```

The `/status` page shows the same thing with a stale-backup warning if the newest is more
than 36 hours old.

## Restore

**1. Stop the app.** Restoring under a running process risks a torn read.

```bash
sudo systemctl stop ssfact
```

**2. Keep the current file.** It is evidence, and it may hold rows the snapshot does not.

```bash
cd /srv/ssfact
cp prod.db "prod.db.broken-$(date +%Y%m%d-%H%M%S)"
```

**3. Put the snapshot in place.**

```bash
cp backups/<chosen-snapshot>.db prod.db
```

Pulling from off-box instead:

```bash
rclone copy "$BACKUP_REMOTE/<chosen-snapshot>.db" ./backups/
cp backups/<chosen-snapshot>.db prod.db
```

**4. Confirm the schema matches the code.** A snapshot older than the last deploy may
predate a migration.

```bash
npx prisma migrate status
npx prisma migrate deploy    # only if it reports pending migrations
```

**5. Start, and verify with data rather than a green light.**

```bash
sudo systemctl start ssfact
curl -fsS http://127.0.0.1:3100/api/health
npm run verify:ledger        # stock must reconcile, or the snapshot is not trustworthy
npx tsx scripts/verify.mts   # job / cut / dispatch counts look sane
```

`verify:ledger` is the real test. If it fails, the restore is not done — try an earlier
snapshot rather than opening the app to the floor.

## If the box itself is gone

1. Provision, install Node and the app per `docs/DEPLOY.md`.
2. `rclone copy "$BACKUP_REMOTE" ./backups/` — pull everything, choose the newest.
3. Follow **Restore** from step 3.

## What is NOT covered

- Uploaded images under `public/uploads/` are **not** in the SQLite snapshot. Back them up
  separately; a restore without them leaves broken image links but a working system.
- Anything written after the newest snapshot is gone. That is the cost of nightly, and the
  reason `/status` shouts when a backup is stale.
