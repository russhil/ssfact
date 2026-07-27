"use client";

import type { AuditRow } from "@/lib/masters";

/**
 * Change 25 Part A — the expanded "what actually changed" view of an audit row.
 *
 * Ported from azadi-dashboard's `src/components/diff-registry.tsx`, keeping the
 * entity-agnostic core — `formatScalar`, the three-column Field/Before/After table,
 * the flatten-a-payload fallback — and dropping every azadi-domain renderer, which
 * was music-catalogue specific. The registry switch there became one generic
 * renderer here: ssfact writes a `summary` at every call site, so the per-entity
 * hand-written cases that switch existed to supply aren't needed.
 *
 * Retheme note: azadi's raw `bg-emerald-100 dark:…` classes are gone — colour comes
 * from the token scale, and this codebase carries zero `dark:` utilities.
 */

type Changes = Record<string, { old: unknown; new: unknown }>;

/* ------------------------------------------------------- value formatting -- */

function formatScalar(v: unknown, depth = 0): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") {
    // ISO timestamps read as noise in a diff cell.
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((item) => formatScalar(item, depth + 1)).join(", ");
  }
  if (typeof v === "object") {
    if (depth > 1) return "{…}";
    const obj = v as Record<string, unknown>;
    // Shape heuristics so the payloads this app actually stores (challan lines,
    // per-colour reversals) read as text instead of falling through to "(object)".
    if (typeof obj.colour === "string" && obj.qty != null) {
      return `${obj.colour} × ${obj.qty}`;
    }
    if (typeof obj.name === "string" && obj.name.trim()) return obj.name;
    const parts = Object.entries(obj)
      .filter(([, val]) => val !== null && val !== undefined && val !== "")
      .map(([k, val]) => `${k}: ${formatScalar(val, depth + 1)}`);
    return parts.length > 0 ? parts.join(", ") : "—";
  }
  return String(v);
}

/* ---------------------------------------------------------- table pieces -- */

function KV({ label, old: oldV, next }: { label: string; old: unknown; next: unknown }) {
  const oldStr = formatScalar(oldV);
  const newStr = formatScalar(next);
  const changed = oldStr !== newStr;
  return (
    <tr className="block border-t border-hairline md:table-row">
      <td className="block px-3 pt-2 pb-0.5 font-mono t-xs text-t3 md:table-cell md:w-[28%] md:py-1.5">{label}</td>
      <td className={`block px-3 pt-0.5 t-xs md:table-cell md:py-1.5 ${changed ? "text-faint line-through" : "text-t3"}`}>
        <span className="mr-1 t-xs text-faint md:hidden">Before:</span>
        {oldStr}
      </td>
      <td className={`block px-3 pt-0.5 pb-2 t-xs font-medium md:table-cell md:py-1.5 ${changed ? "text-t1" : "text-t3"}`}>
        <span className="mr-1 t-xs text-faint md:hidden">After:</span>
        {newStr}
      </td>
    </tr>
  );
}

/**
 * `values` drops the Before column: a context payload is a snapshot, not a diff, and
 * an empty "Before" column reads as "this used to be blank" when it never existed.
 */
function DiffTable({ children, variant = "diff" }: { children: React.ReactNode; variant?: "diff" | "values" }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="block w-full md:table">
        <thead className="hidden bg-surface-2 t-xs uppercase tracking-wide text-faint md:table-header-group">
          <tr>
            <th className="w-[28%] px-3 py-1.5 text-left font-semibold">Field</th>
            {variant === "diff" && <th className="px-3 py-1.5 text-left font-semibold">Before</th>}
            <th className="px-3 py-1.5 text-left font-semibold">{variant === "diff" ? "After" : "Value"}</th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">{children}</tbody>
      </table>
    </div>
  );
}

/** A single field:value row, for the context/snapshot table. */
function Value({ label, value }: { label: string; value: unknown }) {
  return (
    <tr className="block border-t border-hairline md:table-row">
      <td className="block px-3 pt-2 pb-0.5 font-mono t-xs text-t3 md:table-cell md:w-[28%] md:py-1.5">{label}</td>
      <td className="block px-3 pt-0.5 pb-2 t-xs text-t2 md:table-cell md:py-1.5">{formatScalar(value)}</td>
    </tr>
  );
}

/* --------------------------------------------------- payload flattening -- */

/** Nested objects become dotted keys; arrays of objects become indexed paths. */
function flattenForKV(obj: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      const hasObjects = v.some((x) => x !== null && typeof x === "object");
      if (hasObjects) {
        v.forEach((item, i) => {
          if (item && typeof item === "object") {
            out.push(...flattenForKV(item as Record<string, unknown>, `${key}[${i}]`));
          } else {
            out.push([`${key}[${i}]`, item]);
          }
        });
      } else {
        out.push([key, v]);
      }
    } else if (v && typeof v === "object") {
      out.push(...flattenForKV(v as Record<string, unknown>, key));
    } else {
      out.push([key, v]);
    }
  }
  return out;
}

function PayloadKV({ meta }: { meta: Record<string, unknown> }) {
  const entries = flattenForKV(meta);
  if (entries.length === 0) return null;
  return (
    <DiffTable variant="values">
      {entries.map(([k, v]) => (
        <Value key={k} label={k} value={v} />
      ))}
    </DiffTable>
  );
}

/* --------------------------------------------------------------- public -- */

export function AuditDiff({ row }: { row: AuditRow }) {
  const changes = (row.changes ?? {}) as Changes;
  const entries = Object.entries(changes);
  const meta = row.meta ?? {};
  const hasMeta = Object.keys(meta).length > 0;

  if (entries.length === 0 && !hasMeta) {
    return <div className="px-3 py-2 t-xs text-faint">No field-level detail</div>;
  }

  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <DiffTable>
          {entries.map(([k, v]) => (
            <KV key={k} label={k} old={v?.old} next={v?.new} />
          ))}
        </DiffTable>
      )}
      {hasMeta && (
        <div>
          <div className="mb-1.5 t-xs font-semibold uppercase tracking-wide text-faint">Record</div>
          <PayloadKV meta={meta} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- humanisation -- */

/** "vansh.sood@x.com" → "Vansh Sood"; "admin" → "Admin". */
function firstName(username: string): string {
  const local = username.split("@")[0] ?? username;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return username;
  return cleaned
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * The row's one-line sentence. Every ssfact action writes its own `summary` at the
 * call site, so this is azadi's `change_summary`-first branch — lowercase the first
 * letter of an imperative summary and prefix the actor, turning "Voided DC-2026-014"
 * into "Vansh voided DC-2026-014". The fallback covers a summary that ever goes
 * missing rather than rendering a blank line.
 */
export function summarizeAudit(row: AuditRow): string {
  const who = firstName(row.username || "Someone");
  const s = row.summary?.trim();
  if (s) {
    const verb = /^[A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
    return `${who} ${verb}`;
  }
  const verb = row.action.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return row.entityLabel ? `${who} ${verb} ${row.entityLabel}` : `${who} ${verb} ${row.entity}`;
}

export type Tone = "default" | "primary" | "accent" | "danger" | "warn" | "ok";

/** Colour by what the action DOES, not by which action it is — so a new action lands sensibly. */
export function actionTone(action: string): Tone {
  if (/^(void|delete|remove)/.test(action)) return "danger";
  if (/^adjust/.test(action)) return "warn";
  if (/^(edit|update)/.test(action)) return "primary";
  if (/^(create|lock|generate|add)/.test(action)) return "ok";
  return "default";
}
