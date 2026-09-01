/**
 * Minimal cookie parsing/serialization, kept dependency-free since the
 * dashboard's only cookie is a signed, self-contained session value (see
 * sessionCookie.ts) — not worth pulling in a cookie-parsing library for
 * this.
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface SerializeCookieOptions {
  /** Seconds until expiry. 0 clears the cookie immediately. */
  maxAgeSeconds?: number;
  path?: string;
}

export function serializeCookie(
  name: string,
  value: string,
  options: SerializeCookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  parts.push("Secure");
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  return parts.join("; ");
}
