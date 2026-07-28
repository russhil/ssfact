"use client";

/**
 * Change 36 Part 10 Part B — the browser-side queue.
 *
 * Stores DOMAIN INTENT, never the HTTP request. Server actions are POSTs carrying a
 * `Next-Action` id that changes every build, so a captured request replayed after a
 * deploy would hit the wrong action or none at all. What survives a deploy is "the
 * operator recorded this lay", so that is what is stored.
 *
 * Each item carries a client-generated key. The server records honoured keys and returns
 * the original result on a replay, so syncing twice cannot double-post.
 */

export type QueuedAction = "addCuttingLayer" | "recordFabricActuals" | "recordInwardReceipt" | "createInspection";

export type QueueItem = {
  key: string;
  action: QueuedAction;
  payload: unknown;
  at: number;
  attempts: number;
  /** Set when the server refused it — surfaced for the operator, never dropped. */
  error?: string;
};

const DB_NAME = "ssfact-offline";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export async function enqueue(action: QueuedAction, payload: unknown, key = newKey()): Promise<string> {
  await tx("readwrite", (s) => s.put({ key, action, payload, at: Date.now(), attempts: 0 } satisfies QueueItem));
  return key;
}

export async function list(): Promise<QueueItem[]> {
  const all = (await tx<QueueItem[]>("readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>)) ?? [];
  return all.sort((a, b) => a.at - b.at);
}

export async function remove(key: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(key) as unknown as IDBRequest<undefined>);
}

export async function markFailed(key: string, error: string): Promise<void> {
  const item = await tx<QueueItem | undefined>("readonly", (s) => s.get(key) as IDBRequest<QueueItem | undefined>);
  if (!item) return;
  await tx("readwrite", (s) => s.put({ ...item, attempts: item.attempts + 1, error }));
}

export async function depth(): Promise<number> {
  return (await list()).length;
}

/**
 * Replay everything queued, oldest first.
 *
 * ★ A write that cannot apply is NEVER silently dropped — it stays in the queue with its
 * error, so the "needs attention" list can show it and the operator can re-confirm. The
 * only thing that removes an item is the server accepting it.
 */
export async function drain(
  run: (item: QueueItem) => Promise<unknown>
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const item of await list()) {
    try {
      await run(item);
      await remove(item.key);
      sent++;
    } catch (e) {
      await markFailed(item.key, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }
  return { sent, failed };
}
