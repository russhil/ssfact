// Pure, client-safe job-card helpers (NO db import) — usable from client components.

// The real shop-floor lifecycle (Change 12, Part B). Legacy rows may still carry the
// old "STITCHING" value in the DB — normalise it to ON_MACHINE on read (normStage).
export type Stage = "FABRIC_AWAITED" | "CUTTING" | "ON_MACHINE" | "FINISHING" | "DISPATCH";

export const STAGES: Stage[] = ["FABRIC_AWAITED", "CUTTING", "ON_MACHINE", "FINISHING", "DISPATCH"];

export const STAGE_LABEL: Record<Stage, string> = {
  FABRIC_AWAITED: "Fabric awaited",
  CUTTING: "Cutting",
  ON_MACHINE: "On machine",
  FINISHING: "Finishing",
  DISPATCH: "Dispatch",
};

/** Normalise a raw DB stage string (incl. legacy "STITCHING") to a current Stage. */
export const normStage = (s: string | null | undefined): Stage =>
  s === "STITCHING" ? "ON_MACHINE" : ((s as Stage) ?? "CUTTING");

/** Badge tone for a stage — feeds the ok/warn/primary/danger colour scale. */
export const stageTone = (s: Stage): "primary" | "warn" | "ok" | "danger" =>
  s === "FABRIC_AWAITED"
    ? "danger"
    : s === "CUTTING"
      ? "warn"
      : s === "ON_MACHINE"
        ? "primary"
        : s === "FINISHING"
          ? "warn"
          : "ok";

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
