import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getJobs } from "@/lib/jobs";
import { getProducts } from "@/lib/catalog";
import { getVendorList } from "@/lib/masters";

/**
 * Index for the ⌘K palette. Loaded lazily the first time the palette opens, so
 * it never costs anything on a normal page render.
 *
 * `/api/*` is excluded from the proxy.ts matcher, so this route authenticates
 * and role-scopes itself — a VENDOR must only ever see its own cards, and the
 * masters are staff-only.
 */

export type SearchItem = {
  kind: "job" | "product" | "vendor";
  label: string;
  sub: string;
  href: string;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ items: [] }, { status: 401 });

  const isVendor = me.role === "VENDOR";
  const canSeeMasters = me.role === "ADMIN" || me.role === "STAFF";

  const [jobs, products, vendors] = await Promise.all([
    getJobs(isVendor ? { vendorName: me.vendor ?? "" } : undefined),
    canSeeMasters ? getProducts() : Promise.resolve([]),
    canSeeMasters ? getVendorList() : Promise.resolve([]),
  ]);

  const items: SearchItem[] = [
    ...jobs.map((j) => ({
      kind: "job" as const,
      label: j.siNo,
      sub: [j.item, j.vendor].filter(Boolean).join(" · "),
      href: `/job-cards/${j.slug}`,
    })),
    ...products.map((p) => ({
      kind: "product" as const,
      label: p.name,
      sub: [p.skuCode, p.headCategory].filter(Boolean).join(" · "),
      href: `/catalog/${p.extId}`,
    })),
    ...vendors
      .filter((v) => v.active)
      .map((v) => ({
        kind: "vendor" as const,
        label: v.name,
        sub: `${v.jobs} job card${v.jobs === 1 ? "" : "s"}`,
        href: `/vendors/${encodeURIComponent(v.name)}`,
      })),
  ];

  return NextResponse.json({ items });
}
