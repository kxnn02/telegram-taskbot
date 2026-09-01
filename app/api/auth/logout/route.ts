import { NextResponse, type NextRequest } from "next/server";
import { serializeCookie } from "../../../../src/web/cookies";

/**
 * Logout (Phase 6.1, issue #17 — step 3). Nothing server-side to destroy —
 * same as the Express dashboard's `/logout`: the session lives entirely
 * inside the signed cookie (ADR-0008), so logging out just tells the
 * browser to drop it.
 */

const SESSION_COOKIE = "session";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 }));
  return response;
}
