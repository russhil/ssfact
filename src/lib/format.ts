export const nf = new Intl.NumberFormat("en-US");

export const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: dp });

export const compact = (n: number | null | undefined) =>
  n == null ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const pct = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : `${(n * 100).toFixed(dp)}%`;

export const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
};

export const daysBetween = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / 86_400_000);
