import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE, type Role } from "@/lib/session";

const ROUTE_ROLES: { prefix: string; roles: Role[] }[] = [
  // Change 25 Part A: the audit trail names who changed what, so it is owner-only —
  // the same gate as /users, and for the same reason.
  { prefix: "/audit", roles: ["ADMIN"] },
  // Change 25 Part C: /settings/backup hands over the whole database.
  { prefix: "/settings", roles: ["ADMIN"] },
  // The board shows every vendor's work on one screen, so it is staff-only —
  // matching what the sidebar has always offered. Without this rule a VENDOR or
  // TRIMS login could reach it by typing the URL.
  { prefix: "/board", roles: ["ADMIN", "STAFF"] },
  { prefix: "/catalog", roles: ["ADMIN", "STAFF"] },
  { prefix: "/styles", roles: ["ADMIN"] },
  { prefix: "/production-orders", roles: ["ADMIN"] },
  { prefix: "/reports", roles: ["ADMIN"] },
  { prefix: "/users", roles: ["ADMIN"] },
  { prefix: "/vendors", roles: ["ADMIN", "STAFF"] },
  { prefix: "/inventory", roles: ["ADMIN", "STAFF"] },
  { prefix: "/dispatch", roles: ["ADMIN", "STAFF"] },
  // Change 20: the finishing index lists every vendor's job-work on one screen, so it
  // gets the same staff-only gate as /board and /vendors. The sidebar hides it from a
  // VENDOR login, but the sidebar is not a permission model — a typed URL is.
  { prefix: "/finishing", roles: ["ADMIN", "STAFF"] },
  { prefix: "/trims", roles: ["ADMIN", "STAFF", "TRIMS"] },
  { prefix: "/pending-trims", roles: ["ADMIN", "STAFF", "TRIMS"] },
  { prefix: "/suppliers", roles: ["ADMIN", "STAFF"] },
  // Change 25 Part G.2: the issuing-firm master — the other party on every PO.
  { prefix: "/buyers", roles: ["ADMIN", "STAFF"] },
  { prefix: "/fabric-orders", roles: ["ADMIN", "STAFF"] },
  // Change 18 Part B: trim procurement mirrors fabric procurement, same gate.
  // "/pot" must precede "/po" — matching is first-prefix-wins.
  { prefix: "/trim-orders", roles: ["ADMIN", "STAFF"] },
  { prefix: "/pot", roles: ["ADMIN", "STAFF"] },
  { prefix: "/po", roles: ["ADMIN", "STAFF"] },
  { prefix: "/masters", roles: ["ADMIN", "STAFF"] },
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
    // site.webmanifest is public branding metadata — gating it makes the browser
    // fetch fail and drops the install icons for no security benefit.
    //
    // Change 36 Part 10: sw.js must be excluded for the same reason and more urgently.
    // This matcher excludes images but NOT .js, so a gated /sw.js 307s to /login and the
    // browser tries to register an HTML document as a service worker — a MIME-type error
    // and a silent registration failure. The file is a static asset with no data in it.
    "/((?!api|_next/static|_next/image|favicon.ico|site.webmanifest|sw.js|.*\\.(?:png|svg|jpg|jpeg|gif|webp)$).*)",
  ],
};
