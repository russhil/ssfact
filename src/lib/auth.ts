import "server-only";

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  SESSION_COOKIE,
  verifySession,
  type Role,
  type SessionPayload,
} from "@/lib/session";

/** Hash a password using node scrypt (keylen 64), format "<saltHex>:<hashHex>". */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

/** Verify a password against a stored "<saltHex>:<hashHex>" value (matches seed). */
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, salt, 64);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Read + verify the session cookie. Cached per-request. Returns null if absent/invalid. */
export const getCurrentUser = cache(
  async (): Promise<SessionPayload | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    return verifySession(token);
  }
);

/** Throw unless the current user is authenticated and has one of the allowed roles. */
export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}
