import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Change 36 Part 10 Part B — replay protection for queued floor writes.
 *
 * ★ Degrade, don't die. A write made offline is queued in the browser with a
 * client-generated key and replayed on reconnect — possibly more than once, because the
 * queue cannot know whether a request that timed out actually landed.
 *
 * So: the FIRST call with a key does the work and stores what it returned. Every later
 * call with the same key returns that stored result without doing anything. Without this
 * a flaky connection double-posts stock.
 *
 * `withIdempotency` must run INSIDE the caller's transaction, so the record and the work
 * it protects commit together — exactly the reason logAudit takes a tx client too. A
 * record written outside would survive a rolled-back write and permanently block a retry
 * of something that never happened.
 */
export async function withIdempotency<T>(
  tx: Tx,
  actor: { userId: number; username: string },
  key: string | null | undefined,
  action: string,
  fn: () => Promise<T>
): Promise<{ replayed: boolean; result: T }> {
  // No key = an ordinary online call. Nothing to protect against.
  if (!key) return { replayed: false, result: await fn() };

  const existing = await tx.idempotencyRecord.findUnique({ where: { key } });
  if (existing) {
    return {
      replayed: true,
      result: (existing.resultJson ? JSON.parse(existing.resultJson) : null) as T,
    };
  }

  const result = await fn();
  await tx.idempotencyRecord.create({
    data: {
      key,
      action,
      userId: actor.userId,
      username: actor.username,
      resultJson: JSON.stringify(result ?? null),
    },
  });
  return { replayed: false, result };
}

/**
 * Keys are only useful while a client might still retry. Pruning is wired into the
 * nightly backup rather than left to grow — decided now, not after the table is large.
 */
export async function pruneIdempotency(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
  const { count } = await db.idempotencyRecord.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}
