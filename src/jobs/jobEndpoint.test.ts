import { describe, expect, it, vi } from "vitest";
import { handleJobEndpoint, reportConfigError } from "./jobEndpoint.js";

function makeReq(overrides: Partial<{ method: string; headers: Record<string, string> }> = {}) {
  return {
    method: overrides.method ?? "POST",
    headers: overrides.headers ?? { "x-internal-job-secret": "s3cr3t" },
  };
}

describe("handleJobEndpoint", () => {
  it("rejects a non-POST method with 405 without checking auth or running work", async () => {
    const verify = vi.fn().mockReturnValue(true);
    const work = vi.fn();
    const res = await handleJobEndpoint(
      { verify, work, onError: vi.fn() },
      makeReq({ method: "GET" }),
    );
    expect(res.status).toBe(405);
    expect(verify).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("returns 401 when verify rejects the request, without running work", async () => {
    const work = vi.fn();
    const res = await handleJobEndpoint(
      { verify: () => false, work, onError: vi.fn() },
      makeReq(),
    );
    expect(res.status).toBe(401);
    expect(work).not.toHaveBeenCalled();
  });

  it("runs work and returns 200 on success", async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const res = await handleJobEndpoint({ verify: () => true, work, onError: vi.fn() }, makeReq());
    expect(res.status).toBe(200);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("calls onError and returns 500 when work throws, without leaking the raw error", async () => {
    const err = new Error("db down");
    const work = vi.fn().mockRejectedValue(err);
    const onError = vi.fn().mockResolvedValue(undefined);
    const res = await handleJobEndpoint({ verify: () => true, work, onError }, makeReq());
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("still returns 500 if onError itself throws", async () => {
    const work = vi.fn().mockRejectedValue(new Error("db down"));
    const onError = vi.fn().mockRejectedValue(new Error("dm failed"));
    const res = await handleJobEndpoint({ verify: () => true, work, onError }, makeReq());
    expect(res.status).toBe(500);
  });
});

describe("reportConfigError", () => {
  it("reports a config error via onError and returns 500", async () => {
    const onError = vi.fn().mockResolvedValue(undefined);
    const res = await reportConfigError(onError, "CRON_SECRET is not set.");
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledTimes(1);
    const reportedError = onError.mock.calls[0]?.[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toBe("CRON_SECRET is not set.");
  });

  it("still returns 500 if onError itself throws, without leaking that failure", async () => {
    const onError = vi.fn().mockRejectedValue(new Error("dm failed"));
    const res = await reportConfigError(onError, "CRON_SECRET is not set.");
    expect(res.status).toBe(500);
  });
});
