import { SignJWT, jwtVerify } from "jose";

export type Role = "ADMIN" | "STAFF" | "VENDOR" | "TRIMS";

export type SessionPayload = {
  userId: number;
  role: Role;
  username: string;
  displayName: string;
  vendor?: string | null;
};

export const SESSION_COOKIE = "sportsun_session";

const secret = () =>
  new TextEncoder().encode(
    process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me"
  );

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySession(
  token?: string
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: payload.userId as number,
      role: payload.role as Role,
      username: payload.username as string,
      displayName: payload.displayName as string,
      vendor: (payload.vendor as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}
