import { db } from "@/lib/db";
import { splitByLayerVendor, LAYER_VENDOR_INCLUDE } from "@/lib/vendor-split";
import { POSTED } from "@/lib/job-scope";

/**
 * Change 36 Part 1 — what a vendor or supplier is owed, and what is still outstanding.
 *
 * ★ Money is DERIVED from documents, never hand-typed. ssfact already knows the work
 * happened — pieces dispatched, material received on a locked challan — so the bill is
 * computed from those documents every time. Only payments and advances are entered, and
 * they are the one thing that cannot be derived.
 *
 * This is the OPERATIONAL money layer, not statutory accounting. Books stay in Tally;
 * this exports to it. Payables only — no sales receivables.
 *
 * Two rules that shape everything below:
 *  - Vendors bill on DISPATCHED (returned) pieces, not cut pieces. The vendor is owed for
 *    work that actually came back; pieces still on their floor are not yet earned.
 *  - The rate lives on the CUTTING LAYER, falling back to Vendor.jobRate. A card splits
 *    across several layer vendors, so a card-level rate would bill them all the same.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type StatementLine = {
  at: Date;
  kind: string;
  label: string;
  /** what we owe them (work done, goods received) */
  debit: number;
  /** what we've paid them */
  credit: number;
  href: string | null;
};

export type Ageing = { d0_30: number; d31_60: number; d61_90: number; d90plus: number };

export type PartyStatement = {
  partyId: number;
  name: string;
  kind: "VENDOR" | "SUPPLIER";
  /** derived from documents */
  billed: number;
  /** entered payments + advances */
  paid: number;
  /** billed − paid. NEGATIVE means we are in advance with them. */
  outstanding: number;
  ageing: Ageing;
  lines: StatementLine[];
  /** true when some work has no rate agreed, so `billed` understates reality */
  unratedWork: boolean;
};

const DAY = 86400000;
function bucket(ageing: Ageing, at: Date, amount: number, now: number) {
  const days = Math.floor((now - at.getTime()) / DAY);
  if (days <= 30) ageing.d0_30 += amount;
  else if (days <= 60) ageing.d31_60 += amount;
  else if (days <= 90) ageing.d61_90 += amount;
  else ageing.d90plus += amount;
}

/** Per-piece value of a rate, so PER_DOZEN and LUMPSUM don't need special-casing later. */
function perPiece(rate: number | null, type: string | null, qty: number): number | null {
  if (rate == null) return null;
  switch (type) {
    case "PER_DOZEN": return rate / 12;
    case "LUMPSUM": return qty > 0 ? rate / qty : 0;
    default: return rate; // PER_PIECE, and the sane default when unset
  }
}

/* ── Vendor ───────────────────────────────────────────────────────────────── */

async function vendorStatement(vendorId: number, now: number): Promise<PartyStatement> {
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, jobRate: true, jobRateType: true },
  });
  if (!vendor) throw new Error("Vendor not found");

  // Every card this vendor touches, through a layer OR as the header vendor (Change 19 C
  // — a header-only roll-up attributes a split card 100% to one vendor and is wrong).
  const jobs = await db.jobCard.findMany({
    where: {
      ...POSTED,
      OR: [{ vendorId }, { layers: { some: { vendorId } } }],
    },
    select: {
      id: true, siNo: true, cutQty: true, dispatchedQty: true, createdAt: true,
      vendor: { select: { name: true } },
      ...LAYER_VENDOR_INCLUDE,
      // LAYER_VENDOR_INCLUDE already selects `layers` for the split; widen it with the
      // per-layer rate rather than declaring a second `layers` key that would clobber it.
      layers: {
        select: {
          ...LAYER_VENDOR_INCLUDE.layers.select,
          vendorRate: true,
        },
      },
    },
  });

  const lines: StatementLine[] = [];
  const ageing: Ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let billed = 0;
  let unratedWork = false;

  for (const j of jobs) {
    const shares = splitByLayerVendor(j as never);
    const mine = shares.find((s) => s.vendor === vendor.name);
    if (!mine || mine.dispatchedQty <= 0) continue;

    // Prefer this vendor's own layer rate on this card; fall back to the vendor default.
    const myLayer = j.layers.find((l) => l.vendor?.name === vendor.name && l.vendorRate != null);
    const rate = myLayer?.vendorRate ?? vendor.jobRate;
    const unit = perPiece(rate, vendor.jobRateType, mine.dispatchedQty);
    if (unit == null) { unratedWork = true; continue; }

    const amount = r2(mine.dispatchedQty * unit);
    if (amount === 0) continue;
    billed += amount;
    bucket(ageing, j.createdAt, amount, now);
    lines.push({
      at: j.createdAt,
      kind: "WORK_BILL",
      label: `${j.siNo} · ${mine.dispatchedQty} pcs returned`,
      debit: amount,
      credit: 0,
      href: `/job-cards/${j.id}`,
    });
  }

  // Finishing job-work already carries its own rate (FinishingJob.rate × qtyBack) and is
  // a separate head from stitching — counted, but labelled so the two never blur.
  const finishing = await db.finishingJob.findMany({
    where: { vendorId, qtyBack: { gt: 0 }, rate: { not: null } },
    select: { id: true, docNo: true, qtyBack: true, rate: true, createdAt: true, process: true },
  });
  for (const f of finishing) {
    const amount = r2((f.qtyBack ?? 0) * (f.rate ?? 0));
    if (amount === 0) continue;
    billed += amount;
    bucket(ageing, f.createdAt, amount, now);
    lines.push({
      at: f.createdAt, kind: "WORK_BILL",
      label: `${f.docNo ?? `#${f.id}`} · ${f.process} · ${f.qtyBack} pcs`,
      debit: amount, credit: 0, href: "/finishing",
    });
  }

  const paidRows = await db.partyLedgerEntry.findMany({
    where: { vendorId },
    orderBy: { at: "asc" },
  });
  let paid = 0;
  for (const p of paidRows) {
    const signed = p.direction === "CREDIT" ? p.amount : -p.amount;
    paid += signed;
    lines.push({
      at: p.at, kind: p.kind, label: p.note ?? p.kind,
      debit: p.direction === "DEBIT" ? p.amount : 0,
      credit: p.direction === "CREDIT" ? p.amount : 0,
      href: null,
    });
  }

  lines.sort((a, b) => b.at.getTime() - a.at.getTime());
  return {
    partyId: vendor.id, name: vendor.name, kind: "VENDOR",
    billed: r2(billed), paid: r2(paid), outstanding: r2(billed - paid),
    ageing: { d0_30: r2(ageing.d0_30), d31_60: r2(ageing.d31_60), d61_90: r2(ageing.d61_90), d90plus: r2(ageing.d90plus) },
    lines, unratedWork,
  };
}

/* ── Supplier ─────────────────────────────────────────────────────────────── */

async function supplierStatement(supplierId: number, now: number): Promise<PartyStatement> {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) throw new Error("Supplier not found");

  // Payable = Σ(locked, non-voided INWARD challan line qty × rate). Only LOCKED counts:
  // a draft challan is not yet a receipt, and a voided one never happened. This mirrors
  // getJobMargins, which already computes evidenced cost the same way.
  const challans = await db.materialChallan.findMany({
    where: { supplierId, direction: "INWARD", status: "LOCKED", voidedAt: null },
    select: {
      id: true, challanNo: true, date: true,
      lines: { select: { qty: true, rate: true } },
    },
  });

  const lines: StatementLine[] = [];
  const ageing: Ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let billed = 0;
  let unratedWork = false;

  for (const c of challans) {
    const amount = r2(c.lines.reduce((a, l) => a + (l.qty ?? 0) * (l.rate ?? 0), 0));
    if (c.lines.some((l) => l.rate == null)) unratedWork = true;
    if (amount === 0) continue;
    billed += amount;
    bucket(ageing, c.date, amount, now);
    lines.push({
      at: c.date, kind: "PO_BILL",
      label: `${c.challanNo ?? `#${c.id}`} · ${c.lines.length} line${c.lines.length === 1 ? "" : "s"}`,
      debit: amount, credit: 0, href: `/challan-doc/${c.id}`,
    });
  }

  const paidRows = await db.partyLedgerEntry.findMany({ where: { supplierId }, orderBy: { at: "asc" } });
  let paid = 0;
  for (const p of paidRows) {
    paid += p.direction === "CREDIT" ? p.amount : -p.amount;
    lines.push({
      at: p.at, kind: p.kind, label: p.note ?? p.kind,
      debit: p.direction === "DEBIT" ? p.amount : 0,
      credit: p.direction === "CREDIT" ? p.amount : 0,
      href: null,
    });
  }

  lines.sort((a, b) => b.at.getTime() - a.at.getTime());
  return {
    partyId: supplier.id, name: supplier.name, kind: "SUPPLIER",
    billed: r2(billed), paid: r2(paid), outstanding: r2(billed - paid),
    ageing: { d0_30: r2(ageing.d0_30), d31_60: r2(ageing.d31_60), d61_90: r2(ageing.d61_90), d90plus: r2(ageing.d90plus) },
    lines, unratedWork,
  };
}

export async function getPartyStatement(partyId: number, kind: "VENDOR" | "SUPPLIER"): Promise<PartyStatement> {
  const now = Date.now();
  return kind === "VENDOR" ? vendorStatement(partyId, now) : supplierStatement(partyId, now);
}

/**
 * The owner's payables list — worst-aged first. One query per party would be an N+1 over
 * ~25 vendors and ~26 suppliers, but each statement is itself a handful of grouped reads
 * and this only renders on the ADMIN cockpit, so it stays honest rather than cached.
 */
export async function getPayables(): Promise<PartyStatement[]> {
  const [vendors, suppliers] = await Promise.all([
    db.vendor.findMany({ where: { active: true }, select: { id: true } }),
    db.supplier.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const all = await Promise.all([
    ...vendors.map((v) => getPartyStatement(v.id, "VENDOR")),
    ...suppliers.map((s) => getPartyStatement(s.id, "SUPPLIER")),
  ]);
  return all
    .filter((s) => Math.abs(s.outstanding) >= 0.5)
    .sort((a, b) => (b.ageing.d90plus - a.ageing.d90plus) || (b.outstanding - a.outstanding));
}
