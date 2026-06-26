// Pure, client-safe catalog helpers (NO db import) — usable from client components.

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  NEW_ARTICLE: "New Article",
  FUTURE_PLAN: "Future Plan",
  DISCONTINUED: "Discontinued",
  IN_PROCESS: "In Process",
};

export const statusTone = (s: string): "ok" | "primary" | "warn" | "danger" | "default" =>
  s === "ACTIVE"
    ? "ok"
    : s === "NEW_ARTICLE"
      ? "primary"
      : s === "IN_PROCESS"
        ? "warn"
        : s === "DISCONTINUED"
          ? "danger"
          : "default";

/** Wholesale = explicit override, else MRP × 0.5 (the sportsun-os rule). */
export const wholesale = (mrp: number | null, customWsRate: number | null): number | null =>
  customWsRate ?? (mrp != null ? Math.round(mrp * 0.5) : null);
