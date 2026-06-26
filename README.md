# Sportsun — Production OS (demo)

A garment-manufacturing ERP demo that replaces the client's 234-sheet Excel
"daily updates stock form" with a live, linked system: easier entry, masters that
kill double-entry, fabric inventory that depletes from real usage — and now the
**commercial product master, bills of material, a live trims store, and production
orders**, all wired to the production floor.

Seeded from the client's **real data**: the production workbook (250 job cards, 153
styles, 53 fabrics, 18+ vendors), the **223-SKU product master** (from `sportsun-os`),
the **BOM workbook**, and the **TIRMS trims-store register** (1,091 items).
Built with **Next.js 16 · React 19 · Tailwind v4 · Prisma + SQLite · Recharts**.

## Run it

```bash
npm install           # also runs `prisma generate`
npm run dev           # http://localhost:3000
```

The repo ships the seeded SQLite DB (`dev.db`), `prisma/seed.json` and
`prisma/seed_catalog.json`, so it runs immediately — no source files needed.
To re-seed from the committed JSON:

```bash
npm run seed
```

To rebuild everything from the original sources (needs Python + `openpyxl`, the
workbook at `~/Downloads/DAILY UPDATES STOCK FORM 28-11-2025 (1).xlsx`, the
`sportsun-os` sqlite, and the BOM/TIRMS files in `~/Downloads/Sportsun Factory Data/`):

```bash
npm run db:reset      # migrate reset → import (workbook) → import:catalog → seed
```

Catalog/BOM/trims source paths are env-overridable: `SPORTSUN_DB`, `BOM_XLSX`, `TRIMS_CSV`.

## The demo click-path

1. **Dashboard** (`/`) — open on their own numbers: total cut · **Received** (stitched
   goods back in the warehouse — *not* market dispatch, which lives in E-manage) ·
   **35 overdue in red** · vendor receipt bars · weekly trend.
2. **Catalog** (`/catalog`) — the full **223-SKU** commercial range by category, with
   MRP, wholesale and lifecycle status. **89 SKUs link to live production.**
3. **A product, end-to-end** (`/catalog/TSH-MP-301`, MAX POLO) — see its real
   production (**8 job cards · 48,607 cut · 34,602 received**, click through to each),
   then its **Bill of Materials** where every trim shows **live Trims Store stock** —
   a YKK thread and a niwad tape sit at **0 (red)**; unstocked materials read "not tracked".
4. **Trims Store** (`/trims`) — 1,091 trims with live current stock, IN/OUT ledger,
   shortages in red — mirrors the fabric Inventory.
5. **Production** (`/production-orders/new`) — raise an order off the catalog: target
   defaults to **2× monthly sale**, and a **duplicate active order is blocked** ("MAX POLO
   already has PO-01 in progress — raising another would double the cut").
6. **New Job Card** (`/job-cards/new`) — type a style → MRP, fabric, average autofill from
   the **Style Master**; the dark panel checks fabric stock *before* you save.

> The punchline: catalogue, floor, materials and planning rules are one connected
> system — not 213 spreadsheet tabs.

## Architecture

- `scripts/import_workbook.py` — workbook → `prisma/seed.json` (vendors, styles, fabrics, job cards).
- `scripts/import_catalog.py` — `sportsun-os` sqlite + BOM xlsx + TIRMS csv → `prisma/seed_catalog.json`
  (products, BOMs, trims + movements, production orders). Resolves the catalog↔workbook
  link by **normalized SKU**, BOM↔product by style code, and BOM line↔trim by fuzzy family match.
- `prisma/schema.prisma` — Vendor, Fabric, Style, CuttingMaster, JobCard, DispatchEvent,
  SizeBreakup, StockMovement **+ Product, Bom/BomLine, TrimItem/TrimMovement, ProductionOrder**.
- `src/lib/` — `catalog`, `trims`, `production` (query libs), `inventory`, `jobs`, `queries`,
  `actions` (server actions incl. `createProductionOrder` with the duplicate guard).
- `src/app/` — one route per module; `src/components/` — tables, forms, UI primitives.

Notes on the real data: "Dispatched" in the workbook means **received from the vendor**,
so the UI says "Received" (market dispatch is a separate E-manage stream — flagged for later).
Production orders are illustrative demo data against real SKUs. Custom "ORDER" jobs,
production-stage granularity, and the market-dispatch stream are flagged future scope.
