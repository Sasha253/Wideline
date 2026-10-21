import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Redirects signed-out visitors to the login page. This is a convenience only:
// it checks that a session cookie exists, not that it is valid. Permission
// checks happen server-side in requireRole() (AUTH-06).
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/lab/:path*"],
};
