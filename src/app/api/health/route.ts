import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change 36 Part 10 Part D — the health check.
 *
 * Unauthenticated BY DESIGN: a monitor that needs a session cannot tell you the app is
 * down, because a broken app cannot issue one. It sits under /api/*, which proxy.ts
 * already excludes from the auth matcher, and it deliberately returns nothing about the
 * business — just whether the process is up and the database answers.
 */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up", ms: Date.now() - started });
  } catch (e) {
    return Response.json(
      { ok: false, db: "down", error: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    );
  }
}
