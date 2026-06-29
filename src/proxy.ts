import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, type Role } from "@/lib/session";

const ROUTE_ROLES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/catalog", roles: ["ADMIN", "STAFF"] },
  { prefix: "/styles", roles: ["ADMIN"] },
  { prefix: "/production-orders", roles: ["ADMIN"] },
  { prefix: "/reports", roles: ["ADMIN"] },
  { prefix: "/vendors", roles: ["ADMIN", "STAFF"] },
  { prefix: "/inventory", roles: ["ADMIN", "STAFF"] },
  { prefix: "/dispatch", roles: ["ADMIN", "STAFF"] },
  { prefix: "/trims", roles: ["ADMIN", "STAFF", "TRIMS"] },
  { prefix: "/pending-trims", roles: ["ADMIN", "STAFF", "TRIMS"] },
  { prefix: "/suppliers", roles: ["ADMIN", "STAFF"] },
  { prefix: "/fabric-orders", roles: ["ADMIN", "STAFF"] },
  { prefix: "/job-cards", roles: ["ADMIN", "STAFF", "VENDOR"] },
  { prefix: "/challan", roles: ["ADMIN", "STAFF", "VENDOR"] },
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/login")) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const u = req.nextUrl.clone();
    u.pathname = "/login";
    u.searchParams.set("next", pathname);
    return NextResponse.redirect(u);
  }

  const rule = ROUTE_ROLES.find((r) => pathname.startsWith(r.prefix));
  if (rule && !rule.roles.includes(session.role)) {
    const u = req.nextUrl.clone();
    u.pathname =
      session.role === "TRIMS"
        ? "/trims"
        : session.role === "VENDOR"
          ? "/job-cards"
          : "/";
    u.search = "";
    return NextResponse.redirect(u);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|gif|webp)$).*)",
  ],
};
