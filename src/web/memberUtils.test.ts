import { describe, expect, it } from "vitest";
import { memberColor, memberInitials, memberLabel, memberShortLabel, type Member } from "./memberUtils.js";

/**
 * Port of DevieBot's `lib/member-utils.ts` (issue #105 sub-stage 5b) —
 * verbatim logic and 12-hex `COLORS` array, adapted to this repo's `Member`
 * shape (no numeric `id`/`telegram_id`/`name` roster table here, only
 * `roster.username`/`cohort_id`). See `memberUtils.ts`'s doc comment for the
 * one deliberate adaptation beyond a straight port: `memberColor`'s
 * defensive `Number(id)` fallback, since this repo's `id` isn't guaranteed
 * numeric like Devie's is.
 */

describe("memberLabel", () => {
  it("prefers a full name", () => {
    const member: Member = { id: 1, name: "Jane Doe", username: "jdoe" };
    expect(memberLabel(member)).toBe("Jane Doe");
  });

  it("prefers a one-word name over username", () => {
    const member: Member = { id: 1, name: "Jane", username: "jdoe" };
    expect(memberLabel(member)).toBe("Jane");
  });

  it("falls back to @username when there's no name", () => {
    const member: Member = { id: 1, username: "jdoe" };
    expect(memberLabel(member)).toBe("@jdoe");
  });

  it("falls back to #telegramId when there's no name or username", () => {
    const member: Member = { id: 1, telegramId: "555" };
    expect(memberLabel(member)).toBe("#555");
  });

  it("falls back to a bare Member id label when nothing else is present", () => {
    const member: Member = { id: 42 };
    expect(memberLabel(member)).toBe("Member 42");
  });
});

describe("memberShortLabel", () => {
  it("uses the first name only, for a multi-word name", () => {
    const member: Member = { id: 1, name: "Jane Doe" };
    expect(memberShortLabel(member)).toBe("Jane");
  });

  it("returns the single-word name unchanged", () => {
    const member: Member = { id: 1, name: "Jane" };
    expect(memberShortLabel(member)).toBe("Jane");
  });

  it("falls back to username when there's no name", () => {
    const member: Member = { id: 1, username: "jdoe" };
    expect(memberShortLabel(member)).toBe("jdoe");
  });

  it("falls back to telegramId when there's no name or username", () => {
    const member: Member = { id: 1, telegramId: "555" };
    expect(memberShortLabel(member)).toBe("555");
  });

  it("falls back to the bare id when nothing else is present", () => {
    const member: Member = { id: 42 };
    expect(memberShortLabel(member)).toBe("42");
  });
});

describe("memberInitials", () => {
  it("uses first+last initial for a two-word name", () => {
    const member: Member = { id: 1, name: "Jane Doe" };
    expect(memberInitials(member)).toBe("JD");
  });

  it("uses a single initial for a one-word name", () => {
    const member: Member = { id: 1, name: "Jane" };
    expect(memberInitials(member)).toBe("J");
  });

  it("falls back to the first letter of the username when there's no name", () => {
    const member: Member = { id: 1, username: "jdoe" };
    expect(memberInitials(member)).toBe("J");
  });

  it("falls back to the first character of telegramId when there's no name or username", () => {
    const member: Member = { id: 1, telegramId: "555" };
    expect(memberInitials(member)).toBe("5");
  });

  it("falls back to '?' when nothing at all is present", () => {
    const member: Member = { id: 42 };
    expect(memberInitials(member)).toBe("?");
  });
});

describe("memberColor", () => {
  it("is stable across repeated calls for the same member", () => {
    const member: Member = { id: 7, telegramId: "12345" };
    const first = memberColor(member);
    const second = memberColor(member);
    expect(first).toBe(second);
  });

  it("seeds from telegramId when present", () => {
    const withId: Member = { id: 1, telegramId: "10" };
    const withoutId: Member = { id: 10 };
    expect(memberColor(withId)).toBe(memberColor(withoutId));
  });

  it("falls back to a numeric id when there's no telegramId", () => {
    const member: Member = { id: 3 };
    expect(typeof memberColor(member)).toBe("string");
    expect(memberColor(member).startsWith("#")).toBe(true);
  });

  it("coerces a string id to a number", () => {
    const member: Member = { id: "3" };
    const numericMember: Member = { id: 3 };
    expect(memberColor(member)).toBe(memberColor(numericMember));
  });

  it("never throws for a non-numeric string id — falls back to 0 defensively", () => {
    const member: Member = { id: "not-a-number" };
    expect(() => memberColor(member)).not.toThrow();
  });

  it("is in-range (one of the 12 colors) for a negative telegram id", () => {
    const member: Member = { id: 1, telegramId: "-999999" };
    const color = memberColor(member);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("is in-range for a huge telegram id (Number.MAX_SAFE_INTEGER)", () => {
    const member: Member = { id: 1, telegramId: String(Number.MAX_SAFE_INTEGER) };
    const color = memberColor(member);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
