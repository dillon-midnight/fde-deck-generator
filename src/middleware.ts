// RENDERING STRATEGY: Edge Middleware.
// Auth runs at the edge before the request reaches the origin server.
// This is strictly better than the previous pattern of checking useSession()
// in every page component — that caused a flash of unauthenticated content
// while the client-side JS loaded, checked the session, and redirected.
// Middleware prevents the page from rendering at all for unauthenticated
// users: no layout shift, no wasted server compute, no client-side redirect.
import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const token = await getToken({ req });
  if (!token) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/generate/:path*", "/deck/:path*"],
};
