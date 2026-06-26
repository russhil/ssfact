// Pure, client-safe job-card helpers (NO db import) — usable from client components.

export type Stage = "CUTTING" | "STITCHING" | "DISPATCH";

export const STAGES: Stage[] = ["CUTTING", "STITCHING", "DISPATCH"];

export const STAGE_LABEL: Record<Stage, string> = {
  CUTTING: "Cutting",
  STITCHING: "Stitching",
  DISPATCH: "Dispatch",
};

export const stageTone = (s: Stage): "primary" | "warn" | "ok" =>
  s === "CUTTING" ? "warn" : s === "STITCHING" ? "primary" : "ok";

export const DEFAULT_SIZE_RATIO: [string, number][] = [
  ["S", 0.08], ["M", 0.17], ["L", 0.25], ["XL", 0.25], ["2XL", 0.17], ["3XL", 0.08],
];

/**
 * Split a total qty across weighted buckets so the parts sum back to exactly `total`
 * (integer rounding, last bucket absorbs the remainder).
 */
export function splitByRatio(total: number, ratio: [string, number][]): Map<string, number> {
  const out = new Map<string, number>();
  if (ratio.length === 0) return out;
  const sum = ratio.reduce((a, [, w]) => a + w, 0) || 1;
  let run = 0;
  ratio.forEach(([key, w], i) => {
    const q =
      i < ratio.length - 1
        ? Math.round((total * w) / sum)
        : Math.round(total) - run;
    run += q;
    out.set(key, q);
  });
  return out;
}
