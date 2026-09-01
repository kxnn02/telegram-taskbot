import { describe, expect, it } from "vitest";
import { verifyCronSecret, verifyInternalJobSecret } from "./jobAuth.js";

describe("verifyInternalJobSecret", () => {
  it("accepts a matching x-internal-job-secret header", () => {
    expect(
      verifyInternalJobSecret({ "x-internal-job-secret": "s3cr3t" }, "s3cr3t"),
    ).toBe(true);
  });

  it("rejects a mismatched header", () => {
    expect(
      verifyInternalJobSecret({ "x-internal-job-secret": "wrong" }, "s3cr3t"),
    ).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyInternalJobSecret({}, "s3cr3t")).toBe(false);
  });
});

describe("verifyCronSecret", () => {
  it("accepts a matching Authorization: Bearer header (Vercel Cron's convention)", () => {
    expect(
      verifyCronSecret({ authorization: "Bearer s3cr3t" }, "s3cr3t"),
    ).toBe(true);
  });

  it("rejects a mismatched bearer token", () => {
    expect(
      verifyCronSecret({ authorization: "Bearer wrong" }, "s3cr3t"),
    ).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(verifyCronSecret({}, "s3cr3t")).toBe(false);
  });

  it("rejects an Authorization header that isn't a Bearer token", () => {
    expect(verifyCronSecret({ authorization: "s3cr3t" }, "s3cr3t")).toBe(false);
  });
});
