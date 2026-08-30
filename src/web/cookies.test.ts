import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "./cookies.js";

describe("parseCookies", () => {
  it("returns an empty object for an undefined header", () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookies("session=abc123")).toEqual({ session: "abc123" });
  });

  it("parses multiple cookies separated by '; '", () => {
    expect(parseCookies("session=abc123; theme=dark")).toEqual({
      session: "abc123",
      theme: "dark",
    });
  });

  it("trims stray whitespace around cookie pairs", () => {
    expect(parseCookies("session=abc123;  theme=dark")).toEqual({
      session: "abc123",
      theme: "dark",
    });
  });

  it("decodes URI-encoded values", () => {
    expect(parseCookies("name=hello%20world")).toEqual({ name: "hello world" });
  });
});

describe("serializeCookie", () => {
  it("produces a Secure, HttpOnly, SameSite=Lax cookie by default", () => {
    const header = serializeCookie("session", "abc123");
    expect(header).toContain("session=abc123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });

  it("supports an explicit Max-Age for expiry, and clearing via Max-Age=0", () => {
    const header = serializeCookie("session", "", { maxAgeSeconds: 0 });
    expect(header).toContain("Max-Age=0");
  });
});
