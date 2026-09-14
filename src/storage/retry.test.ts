import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTransientError, withRetry, type RetryOptions } from "./retry.js";

describe("retry module", () => {
  describe("isTransientError", () => {
    it("returns true for an Error with message containing 'Gateway Timeout'", () => {
      const err = new Error("listTasksByCohort(c1) failed: Gateway Timeout");
      expect(isTransientError(err)).toBe(true);
    });

    it("returns false for an Error with a non-transient message", () => {
      const err = new Error('column "titel" does not exist');
      expect(isTransientError(err)).toBe(false);
    });

    it("returns false for null, undefined, and non-Error values", () => {
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
      expect(isTransientError("a string")).toBe(false);
      expect(isTransientError({})).toBe(false);
      expect(isTransientError(42)).toBe(false);
    });
  });

  describe("withRetry", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns the value on first success without delaying", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return "success";
      };

      const result = await withRetry(fn);
      expect(result).toBe("success");
      expect(callCount).toBe(1);
    });

    it("succeeds on attempt 2 when attempt 1 throws a transient error", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Gateway Timeout");
        }
        return "success";
      };

      const result = await withRetry(fn);
      expect(result).toBe("success");
      expect(callCount).toBe(2);
    });

    it("does NOT retry a non-transient error", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new Error("syntax error in query");
      };

      await expect(withRetry(fn)).rejects.toThrow("syntax error in query");
      expect(callCount).toBe(1);
    });

    it("exhausts 3 attempts on repeated transient errors and rethrows the last error with message intact", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new Error(`attempt ${callCount}: timeout`);
      };

      await expect(withRetry(fn)).rejects.toThrow("attempt 3: timeout");
      expect(callCount).toBe(3);
    });

    it("respects custom attempts option", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new Error("timeout");
      };

      await expect(withRetry(fn, { attempts: 2 })).rejects.toThrow("timeout");
      expect(callCount).toBe(2);
    });

    it("respects custom baseDelayMs option", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("timeout");
        }
        return "success";
      };

      const result = await withRetry(fn, { baseDelayMs: 100, attempts: 3 });
      expect(result).toBe("success");
      expect(callCount).toBe(3);
    });
  });
});
