import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { SessionPayload } from "@/lib/session";

/**
 * Change 25 Part A — the accountability log.
 *
 * Ported from azadi-dashboard (`src/lib/audit.ts`), with two deliberate divergences:
 *
 *  1. **Transactional.** azadi's `auditLog()` swallows its own errors and writes on a
 *     separate pooled connection, so an audit row survives a rolled-back mutation.
 *     Here `logAudit` takes the transaction client as its first argument — the same
 *     idiom as `postMaterialMovement` — so the log and the change it describes commit
 *     together or not at all. In a system of record that reconciles a stock ledger,
 *     an audit row describing a change that never happened is worse than no row.
 *  2. **JSON as TEXT.** This schema stores JSON in `String` columns (see
 *     `CuttingLayer.sizeRatio`); `changes` / `meta` are stringified on write and
 *     parsed on read by the /audit page.
 *
 * The actor is passed in rather than read from cookies, so the helper works from
 * scripts and back-compat call paths that have no session. Every action already holds
 * the value `requireRole()` returned, which carries `userId` / `username`.
 */

type Client = Prisma.TransactionClient | typeof db;

/** What `requireRole()` returns — actions pass it straight through. */
export type AuditActor = Pick<SessionPayload, "userId" | "username">;

export type AuditChanges = Record<string, { old: unknown; new: unknown }>;

export type AuditEntry = {
  /** The action's own function name, e.g. "voidDispatch". */
  action: string;
  /** The Prisma model name, e.g. "DispatchEvent". */
  entity: string;
  entityId: string | number;
  /** What a human calls this row — "DC-2026-014", "SI-1188". */
  entityLabel?: string | null;
  /** One plain line: "Voided DC-2026-014, +12 pcs back to SI-1188". */
  summary: string;
  changes?: AuditChanges | null;
  meta?: Record<string, unknown> | null;
};

export async function logAudit(
  client: Client,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: actor.userId ?? null,
      username: actor.username,
      action: entry.action,
      entity: entry.entity,
      entityId: String(entry.entityId),
      entityLabel: entry.entityLabel ?? null,
      summary: entry.summary,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
      meta: entry.meta ? JSON.stringify(entry.meta) : null,
    },
  });
}

const DEFAULT_IGNORED = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdById",
  "updatedById",
  "passwordHash",
]);

/**
 * Field-level diff of a row before/after an update — verbatim from azadi apart from the
 * camelCase ignore list. Returns null when nothing actually changed, so a no-op edit
 * writes an audit row with a summary but no diff table.
 */
export function computeChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  opts?: { ignore?: string[] },
): AuditChanges | null {
  const diff: AuditChanges = {};
  const skip = new Set(DEFAULT_IGNORED);
  for (const k of opts?.ignore ?? []) skip.add(k);
  for (const key of Object.keys(after)) {
    if (skip.has(key)) continue;
    const a = (after as Record<string, unknown>)[key];
    const b = (before as Record<string, unknown>)[key];
    if (a === undefined) continue;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diff[key] = { old: b ?? null, new: a ?? null };
    }
  }
  return Object.keys(diff).length ? diff : null;
}
