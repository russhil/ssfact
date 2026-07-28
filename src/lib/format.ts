/* Indian digit grouping throughout: 5,99,880 — not 599,880. Dates stay en-GB below. */
export const nf = new Intl.NumberFormat("en-IN");

export const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: dp });

/** Words, not symbols: "6 lakh", "1.2 crore". */
export const compact = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Intl.NumberFormat("en-IN", { notation: "compact", compactDisplay: "long", maximumFractionDigits: 1 }).format(n);

export const pct = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : `${(n * 100).toFixed(dp)}%`;

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
};

export const daysBetween = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / 86_400_000);
