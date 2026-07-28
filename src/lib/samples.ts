import { db } from "@/lib/db";

/**
 * Change 36 Part 7 — the read side of sampling.
 *
 * The cost sheet is owner-only wherever it is rendered; this module returns the figures
 * and the page decides who may see them, the same discipline /reports follows.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function listSamples() {
  const rows = await db.sample.findMany({
    orderBy: [{ status: "asc" }, { code: "desc" }],
    include: {
      product: { select: { name: true, skuCode: true } },
      vendor: { select: { name: true } },
      costLines: { select: { qty: true, rate: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    round: s.round,
    status: s.status as string,
    product: s.product?.name || s.product?.skuCode || null,
    vendor: s.vendor?.name ?? null,
    targetMrp: s.targetMrp,
    cost: r2(s.costLines.reduce((a, l) => a + l.qty * l.rate, 0)),
    createdAt: s.createdAt,
  }));
}

export type SampleRow = Awaited<ReturnType<typeof listSamples>>[number];

export async function getSample(id: number) {
  const s = await db.sample.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true, skuCode: true, fabric: { select: { name: true } } } },
      vendor: { select: { name: true } },
      requestedBy: { select: { displayName: true, username: true } },
      costLines: { orderBy: { id: "asc" } },
      measurements: { orderBy: [{ pom: "asc" }, { size: "asc" }] },
      images: { orderBy: { id: "asc" } },
    },
  });
  if (!s) return null;

  const cost = r2(s.costLines.reduce((a, l) => a + l.qty * l.rate, 0));
  // Margin is only meaningful once a target price exists — otherwise it reads -100%.
  const margin = s.targetMrp && s.targetMrp > 0 ? (s.targetMrp - cost) / s.targetMrp : null;

  return { ...s, cost, margin };
}

/**
 * Where "Start bulk" points. It PRE-FILLS the new-card form rather than calling
 * createJobCard, because that action is not inert: it snapshots the BOM, sets trims
 * pending and drives fabric maths. A speculative card would be real inventory pressure
 * and would burn an SI- number on a style nobody has committed to yet.
 */
export function startBulkHref(sample: { id: number; productId: number | null }): string | null {
  if (!sample.productId) return null;
  return `/job-cards/new?productId=${sample.productId}&sampleId=${sample.id}`;
}

/** The tech-pack projection: everything printable about a sample, in one read. */
export async function getSampleDoc(id: number) {
  const s = await getSample(id);
  if (!s) return null;

  // Trims come from the product's BOM (which is trim-only in this schema — see
  // src/lib/yield.ts for why there is no fabric BOM to read).
  const bom = s.product
    ? await db.bom.findFirst({
        where: { productId: s.product.id },
        include: { lines: { include: { trimItem: { select: { name: true, unit: true } } } } },
      })
    : null;

  const sizes = [...new Set(s.measurements.map((m) => m.size))];
  const poms = [...new Set(s.measurements.map((m) => m.pom))];
  const grid = new Map<string, { valueCm: number; tolerance: number | null }>();
  for (const m of s.measurements) grid.set(`${m.pom}|${m.size}`, { valueCm: m.valueCm, tolerance: m.tolerance });

  return { sample: s, bom, sizes, poms, grid };
}
