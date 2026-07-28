# Change 36 + 37 — what needs setting up on the box

Everything in these changes deploys through the normal GitHub Actions workflow. **Three
things ship inert** until you configure them on the server, and **one thing needs
watching** on the first deploy.

Nothing here blocks the rest: skip a section and that feature simply stays off.

---

## What already works, with no action

- **All 8 migrations.** The workflow runs `sudo DATABASE_URL="file:./dev.db" npx prisma
  migrate deploy` before building. Every column added is nullable and every table is new,
  so existing rows are untouched.
- **`dev.db` is safe.** The rsync step excludes `dev.db`, `dev.db-wal`, `dev.db-shm`,
  `dev.db.bak*` and `prisma/dev.db`, and the box takes its own timestamped copy before
  migrating. The repo copy can never overwrite production.
- **No new npm dependencies.** `npm ci` needs nothing new; only two scripts were added
  (`verify:ledger`, `seed:defects`).
- **`.env` is excluded from rsync**, so the variables below must be set on the box, not
  committed.
- Every page, route, action and selector — masters delete, per-colour fabric, accounts,
  quality, planning, yield, scorecards, samples, trace, `/my-work`, `/status`,
  `/api/health`.

---

## 1. Daily digest — needs a secret and a cron line *(Part 2)*

Without `CRON_SECRET` the route answers `503` and refuses to run. That is deliberate: an
unguarded endpoint that emails the owner's payables position is worse than no digest.

**On the box**, add to `.env`:

```bash
CRON_SECRET="$(openssl rand -hex 32)"
```

Then install the cron the same way the backup one is installed — a file with a user
field, because `crontab -` reads stdin and an SSH heredoc eats it:

```bash
sudo tee /etc/cron.d/ssfact-digest >/dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 8 * * * root curl -fsS -H "x-cron-key: PUT_THE_SECRET_HERE" http://127.0.0.1:3100/api/cron/digest >> /var/log/ssfact-digest.log 2>&1
EOF
```

Replace `PUT_THE_SECRET_HERE` with the value from `.env`, and check the port matches the
app's systemd unit.

**Verify:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/cron/digest          # 403
curl -s -H "x-cron-key: $CRON_SECRET" http://127.0.0.1:3100/api/cron/digest             # {"ok":true,...}
```

**Note:** the gateway is **log-only by design**. Nothing leaves the building — every alert
lands in the in-app bell. Wiring a real WhatsApp or SMTP sender means implementing the
single `deliver()` function in `src/lib/notify.ts`; no call site changes.

Alerts also have nowhere to *address* until someone fills in a phone or email at
**Settings → Notifications**. With neither set they stay in-app, which is fine.

---

## 2. Defect list — needs seeding once *(Part 3)*

The Inspect sheet lets you record pass/reject/rework immediately, but the **defect
checkboxes are empty** until the list exists.

```bash
cd /opt/sportsun-factory
sudo DATABASE_URL="file:./dev.db" npm run seed:defects
```

Idempotent — safe to re-run. Seeds 16 defects under the names a garment floor actually
uses (broken stitch, skip stitch, print misalign, shade variation, …). The owner can edit
or add more afterwards.

---

## 3. Off-box backup — needs rclone and a remote *(Part 10)*

Backups already run nightly, but **onto the same disk as the database**. That survives a
mistake, not a dead box. You chose an S3-compatible bucket (Backblaze B2 / S3).

```bash
sudo apt-get install -y rclone
sudo rclone config          # create a remote, e.g. named "b2", pointing at your bucket
```

Then in `.env`:

```bash
BACKUP_REMOTE="b2:ssfact-backups"
```

`npm run backup` now copies each snapshot off-box straight after writing it. **A copy
failure is reported but does not fail the run** — a local backup that exists beats no
backup because the network was down.

**Verify:**

```bash
sudo DATABASE_URL="file:./dev.db" npm run backup     # expect "copied off-box → b2:…"
rclone ls b2:ssfact-backups | tail -3
```

The existing README suggests an `rsync` line for the same purpose. Use one or the other,
not both.

`/status` shows the newest backup and turns **red past 36 hours**, which is the check that
actually catches a silently broken cron.

---

## 4. The service worker — watch the first deploy *(Part 10)*

This is the only part that can bite. It needs **no configuration** and registers itself,
but the first deploy installs it on every device that opens the app.

It is written to avoid the three failure modes that matter here:

- **HTML is network-first.** All 39 pages are `force-dynamic` and show live stock, so a
  cached page is a lifeboat, never the default.
- **The cache is versioned and purged on activate**, because deploy rsyncs with `--delete`
  and a cached page pointing at the previous build's chunks is a white screen.
- **Non-GET is never intercepted**, so server actions are untouched.

`/sw.js` also had to be excluded from the auth matcher in `src/proxy.ts` — it was being
307'd to `/login`, and the browser would have tried to register an HTML document as a
worker. Verified returning `200`.

**Recommended: deploy this one on its own**, then check on a phone and a desktop:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://sportsunfactory.goatedd.tech/sw.js   # 200
```

In the browser: DevTools → Application → Service Workers should show one worker,
*activated*. Load a page, turn off wifi, reload — you should get the cached page with the
offline banner, not a browser error.

**If it ever misbehaves**, unregister and the app returns to normal immediately:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))
```

Removing `public/sw.js` and redeploying also works; existing workers self-purge on the
next activate.

---

## 5. Features that are on, but empty until data is entered

Not setup — just worth knowing why a screen looks blank on day one.

| Screen | Stays empty until |
|---|---|
| Payables widget, `/vendors/[name]/account` | a vendor has a **job rate** (set it on the account page) |
| `/planning` projections | a vendor has **pieces/day** (set it inline on the board) |
| Fabric yield line and report | the product has **avg consumption**, or the card has an override |
| `/trace` | someone types a **lot number** on an inward challan line and on a lay |
| Supplier scorecards | there are **completed purchase orders** in the period |

None of these need a migration or a restart — enter the number and the screen fills.

---

## After deploying: prove it, don't assume it

```bash
cd /opt/sportsun-factory
curl -fsS http://127.0.0.1:3100/api/health            # {"ok":true,"db":"up"}
sudo DATABASE_URL="file:./dev.db" npm run verify:ledger   # must PASS
sudo npx prisma migrate status                        # no pending migrations
```

`verify:ledger` is the one that matters — it asserts stock integrity across every
`(fabric, colour)` row and that every card's ledger reconciles to its entered USED. Treat
a failure as a blocker, not a warning.
