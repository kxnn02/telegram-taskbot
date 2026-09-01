import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./sessionCookie.js";
import type { Caller } from "../domain/types.js";

const SECRET = "test-session-secret";
const carla: Caller = { username: "carla", role: "HigherUp", cohortId: "cohort-5" };

describe("signSession / verifySession", () => {
  it("round-trips a signed session back to the original caller", () => {
    const cookieValue = signSession(carla, SECRET);
    const result = verifySession(cookieValue, SECRET);
    expect(result).toEqual({ ok: true, session: carla });
  });

  it("rejects a cookie whose payload was tampered with", () => {
    const cookieValue = signSession(carla, SECRET);
    const [payload, signature] = cookieValue.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...carla, role: "Intern" })).toString(
      "base64url",
    );
    const tampered = `${tamperedPayload}.${signature}`;
    expect(tampered).not.toBe(cookieValue);
    void payload;
    const result = verifySession(tampered, SECRET);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a cookie whose signature was tampered with", () => {
    const cookieValue = signSession(carla, SECRET);
    const [payload] = cookieValue.split(".");
    const tampered = `${payload}.${"0".repeat(64)}`;
    const result = verifySession(tampered, SECRET);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookieValue = signSession(carla, "a-completely-different-secret");
    const result = verifySession(cookieValue, SECRET);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired session", () => {
    let now = 0;
    const clock = () => now;
    const cookieValue = signSession(carla, SECRET, { ttlMs: 1000, clock });
    now = 1500;
    const result = verifySession(cookieValue, SECRET, { clock });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("keeps a session alive within its TTL window", () => {
    let now = 0;
    const clock = () => now;
    const cookieValue = signSession(carla, SECRET, { ttlMs: 1000, clock });
    now = 500;
    const result = verifySession(cookieValue, SECRET, { clock });
    expect(result).toEqual({ ok: true, session: carla });
  });

  it("defaults to a 12h TTL when none is configured", () => {
    let now = 0;
    const clock = () => now;
    const cookieValue = signSession(carla, SECRET, { clock });
    now = 12 * 60 * 60 * 1000 - 1;
    expect(verifySession(cookieValue, SECRET, { clock })).toEqual({ ok: true, session: carla });
    now = 12 * 60 * 60 * 1000 + 1;
    expect(verifySession(cookieValue, SECRET, { clock })).toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    ["empty string", ""],
    ["no separator", "justsomegarbage"],
    ["too many separators", "a.b.c"],
    ["non-base64 payload", "!!!not-base64!!!.abcdef"],
    ["non-JSON payload", `${Buffer.from("not json").toString("base64url")}.abcdef`],
  ])("rejects a malformed cookie value (%s) without throwing", (_label, value) => {
    expect(() => verifySession(value, SECRET)).not.toThrow();
    expect(verifySession(value, SECRET)).toEqual({ ok: false, reason: "invalid" });
  });
});
