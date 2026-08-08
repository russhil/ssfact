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

/**
 * Change 40 B4 — a rupee amount in words, Indian numbering (lakh / crore). Standard on every
 * Indian PO; it prevents figure tampering. Rounds to whole rupees.
 */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}

export function amountInWords(amount: number | null | undefined): string {
  if (amount == null) return "—";
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoDigits(n));
  const sign = amount < 0 ? "Minus " : "";
  return `${sign}Rupees ${parts.join(" ")} Only`;
}

/** Change 40 B3 — the state name for a GSTIN's first two digits (place of supply). */
const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const gstStateCode = (gstin: string | null | undefined) => (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null);
export const gstStateName = (gstin: string | null | undefined) => {
  const code = gstStateCode(gstin);
  return code ? GST_STATES[code] ?? `State ${code}` : null;
};
