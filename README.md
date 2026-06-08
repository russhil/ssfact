# Sportsun — Production OS (demo)

A garment-manufacturing ERP demo that replaces the client's 234-sheet Excel
"daily updates stock form" with a live, linked system: easier entry, masters that
kill double-entry, and fabric inventory that depletes from real usage.

Seeded from the client's actual workbook (250 job cards, 153 styles, 53 fabrics,
18+ vendors). Built with **Next.js 16 · React 19 · Tailwind v4 · Prisma + SQLite · Recharts**.

## Run it

```bash
npm install           # also runs `prisma generate`
npm run dev           # http://localhost:3000
```

The repo ships with the seeded SQLite DB (`dev.db`) and `prisma/seed.json`, so it runs
immediately — no workbook needed. To re-seed a clean dataset from `seed.json`:

```bash
npm run seed
```

To rebuild `seed.json` from the original Excel (only on a machine that has the workbook
at `~/Downloads/DAILY UPDATES STOCK FORM 28-11-2025 (1).xlsx`, needs Python + `openpyxl`):

```bash
npm run import        # workbook -> prisma/seed.json
npm run seed          # seed.json -> SQLite
```

## The 5-beat demo click-path

1. **Dashboard** (`/`) — open on their own numbers: 876,284 cut · 588,120 dispatched ·
   **35 overdue in red** · vendor fill bars · weekly trend. "This is your factory, live."
2. **New Job Card** (`/job-cards/new`) — type `TRUMP` → pick `TP-TRUMP-824` → Item, MRP,
   Fabric, Average all **autofill** from the Style Master. The dark panel computes
   fabric required vs **live stock** and shows ✓ Enough / ⚠ Short *before* you save.
   Bump Cut Qty up to trip the red shortage warning. Save.
3. **Inventory** (`/inventory`) → open the fabric you just used — its **available stock
   has dropped** and the new issue is in the ledger. 8 fabrics already flag red "Indent".
4. **Dispatch** (`/dispatch`) — log a shipment against an open job → balance and the
   dashboard update instantly.
5. **Vendors** (`/vendors`) — drill into a laggard (Ramanreti 60%) to see every late job.

## Architecture

- `scripts/import_workbook.py` — workbook → `prisma/seed.json` (normalizes units, junk
  cells, vendor combos; synthesizes opening stock + hero size/dispatch detail).
- `prisma/schema.prisma` — Vendor, Fabric, Style (master), CuttingMaster, JobCard,
  DispatchEvent, SizeBreakup, StockMovement (the ledger that makes stock live).
- `src/lib/` — `db` (Prisma adapter), `queries` (dashboard), `jobs`, `inventory`, `actions`
  (server actions: create job card, add dispatch).
- `src/app/` — one route per module; `src/components/` — UI primitives + interactive bits.

Swap SQLite → Postgres later by changing only the datasource/adapter; the schema and app stay.
