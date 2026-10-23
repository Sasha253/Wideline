import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Redirects signed-out visitors to the login page. This is a convenience only:
// it checks that a session cookie exists, not that it is valid. Permission
// checks happen server-side in requireRole() (AUTH-06).
//
// It also passes the requested path on in the x-wl-path header (PATH_HEADER in
// src/server/auth/session.ts), so requirePageRole can send an expired session
// to /login?next=<path>. /invite and /apply are public and not matched.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname + request.nextUrl.search;
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  const headers = new Headers(request.headers);
  headers.set("x-wl-path", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/lab/:path*",
    "/dev/:path*",
    "/settings/:path*",
    "/organisations/:path*",
    "/admin/:path*",
  ],
};
