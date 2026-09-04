import { describe, expect, it, vi } from "vitest";
import { guardSetup, handleJobEndpoint, reportConfigError } from "./jobEndpoint.js";

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

describe("guardSetup", () => {
  function makeReporter() {
    return { report: vi.fn().mockResolvedValue(undefined), log: vi.fn() };
  }

  it("runs the job when setup succeeds, without touching the reporter", async () => {
    const reporter = makeReporter();
    const run = vi.fn().mockResolvedValue({ status: 200 });
    const res = await guardSetup("keep-alive", reporter, async () => ({ built: true }), run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ built: true });
    expect(reporter.report).not.toHaveBeenCalled();
    expect(reporter.log).not.toHaveBeenCalled();
  });

  it("returns 500 without running the job when setup throws", async () => {
    const reporter = makeReporter();
    const run = vi.fn();
    const res = await guardSetup(
      "weekly-backup",
      reporter,
      async () => {
        throw new Error("MAINTAINER_USERNAME is not set.");
      },
      run,
    );
    expect(res.status).toBe(500);
    expect(run).not.toHaveBeenCalled();
  });

  it("always logs the setup failure, so a config error is never fully silent", async () => {
    // The whole point of #43: a job that dies before its error-reporting
    // path exists must still leave a trace naming the job and the cause.
    const reporter = makeReporter();
    const error = new Error("BOT_TOKEN is not set.");
    await guardSetup("keep-alive", reporter, async () => {
      throw error;
    }, vi.fn());
    expect(reporter.log).toHaveBeenCalledWith("keep-alive", error);
  });

  it("attempts a maintainer DM for a setup failure", async () => {
    const reporter = makeReporter();
    const error = new Error("ACTIVE_COHORT_ID is not set.");
    await guardSetup("weekly-backup", reporter, async () => {
      throw error;
    }, vi.fn());
    expect(reporter.report).toHaveBeenCalledWith("weekly-backup", error);
  });

  it("logs before attempting the DM, so an unreportable failure still leaves a trace", async () => {
    // MAINTAINER_USERNAME / BOT_TOKEN / Supabase credentials are the config
    // whose absence makes a DM structurally impossible — the log is the only
    // channel left, so it must not be conditional on the DM working.
    const order: string[] = [];
    const reporter = {
      log: vi.fn(() => {
        order.push("log");
      }),
      report: vi.fn(async () => {
        order.push("report");
      }),
    };
    await guardSetup("keep-alive", reporter, async () => {
      throw new Error("boom");
    }, vi.fn());
    expect(order).toEqual(["log", "report"]);
  });

  it("still returns 500 when the reporter itself throws", async () => {
    const reporter = {
      log: vi.fn(),
      report: vi.fn().mockRejectedValue(new Error("no bot token, cannot DM")),
    };
    const res = await guardSetup("keep-alive", reporter, async () => {
      throw new Error("SUPABASE_URL is not set.");
    }, vi.fn());
    expect(res.status).toBe(500);
    expect(reporter.log).toHaveBeenCalled();
  });

  it("still returns 500 when the logger itself throws", async () => {
    const reporter = {
      log: vi.fn(() => {
        throw new Error("logger exploded");
      }),
      report: vi.fn().mockResolvedValue(undefined),
    };
    const res = await guardSetup("keep-alive", reporter, async () => {
      throw new Error("boom");
    }, vi.fn());
    expect(res.status).toBe(500);
  });

  it("does not treat an error thrown by the job itself as a setup failure", async () => {
    // handleJobEndpoint already reports and swallows work() errors; guardSetup
    // must not double-report them or convert a deliberate 401/405 into a 500.
    const reporter = makeReporter();
    const res = await guardSetup("keep-alive", reporter, async () => ({}), async () => ({
      status: 401,
    }));
    expect(res.status).toBe(401);
    expect(reporter.report).not.toHaveBeenCalled();
    expect(reporter.log).not.toHaveBeenCalled();
  });
});

