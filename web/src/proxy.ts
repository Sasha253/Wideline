import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Redirects signed-out visitors to the login page. This is a convenience only:
// it checks that a session cookie exists, not that it is valid. Permission
// checks happen server-side in requireRole() (AUTH-06).
//
// It also passes the requested path on in the x-wl-path header (PATH_HEADER in
// src/server/auth/session.ts), so requirePageRole can send an expired session
// to /login?next=<path>.
//
// The matcher takes every path apart from the public ones (/login, /apply,
// /invite), the API, Next.js internals and files with an extension, so a new
// shell page is covered without editing this file. The root / is matched too,
// which is harmless: it sends signed-out visitors to /login anyway.
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
  matcher: ["/((?!login|apply|invite|api|_next|favicon\\.ico|robots\\.txt|.*\\..*).*)"],
};
