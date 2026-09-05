import { describe, expect, it, vi } from "vitest";
import { InMemoryAlertThrottleStore } from "../storage/inMemoryAlertThrottleStore.js";
import { InMemoryOverdueNotificationStore } from "../storage/inMemoryOverdueNotificationStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryCohortStore } from "../storage/inMemoryCohortStore.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import {
  runDailyDigestJob,
  runDueSoonReminderJob,
  runOverdueCrossingJob,
  runWeeklyDigestJob,
} from "./notificationJobs.js";
import type { NotificationJobDeps } from "./notificationJobs.js";

function makeDeps(): NotificationJobDeps & { sendMessage: ReturnType<typeof vi.fn> } {
  const roster = new Roster([
    { username: "alice", cohortId: "cohort-5" },
    { username: "bob", cohortId: "cohort-5" },
  ]);
  const service = new TaskService(new InMemoryTaskStore(), roster, new FixedClock(new Date("2026-09-01T00:00:00Z")));
  const sendMessage = vi.fn();
  return {
    bot: { api: { sendMessage } },
    registrations: new InMemoryRegistrationStore(),
    service,
    roster,
    overdueNotifications: new InMemoryOverdueNotificationStore(),
    cohorts: new InMemoryCohortStore({ "cohort-5": "-100999" }),
    throttle: new InMemoryAlertThrottleStore(),
    sendMessage,
  };
}

describe("runOverdueCrossingJob / runDueSoonReminderJob", () => {
  it("run without throwing against an empty cohort", async () => {
    const deps = makeDeps();
    await expect(runOverdueCrossingJob(deps, "cohort-5")).resolves.toBeUndefined();
    await expect(runDueSoonReminderJob(deps, "cohort-5")).resolves.toBeUndefined();
  });
});

describe("runDailyDigestJob", () => {
  it("sends digests the first time it runs for a given Manila calendar day", async () => {
    const deps = makeDeps();
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");

    await runDailyDigestJob(deps, "cohort-5", new Date("2026-09-01T02:00:00Z"));

    expect(deps.sendMessage).toHaveBeenCalled();
  });

  it("skips sending on a retry for the same Manila calendar day (already claimed)", async () => {
    const deps = makeDeps();
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");

    await runDailyDigestJob(deps, "cohort-5", new Date("2026-09-01T02:00:00Z"));
    deps.sendMessage.mockClear();
    await runDailyDigestJob(deps, "cohort-5", new Date("2026-09-01T02:05:00Z"));

    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it("sends again on the next Manila calendar day", async () => {
    const deps = makeDeps();
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");

    await runDailyDigestJob(deps, "cohort-5", new Date("2026-09-01T02:00:00Z"));
    deps.sendMessage.mockClear();
    await runDailyDigestJob(deps, "cohort-5", new Date("2026-09-02T02:00:00Z"));

    expect(deps.sendMessage).toHaveBeenCalled();
  });
});

describe("runWeeklyDigestJob", () => {
  async function makeDepsWithOpenTask() {
    const deps = makeDeps();
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");
    await deps.service.assignTask(
      { username: "bob", cohortId: "cohort-5" },
      {
        assigneeUsername: "alice",
        title: "Do a thing",
        description: "Details",
        dueDate: "2026-09-10",
      },
    );
    return deps;
  }

  it("sends digests the first time it runs for a given Manila calendar week", async () => {
    const deps = await makeDepsWithOpenTask();

    // 2026-08-31 is a Monday.
    await runWeeklyDigestJob(deps, "cohort-5", new Date("2026-08-31T02:00:00Z"));

    expect(deps.sendMessage).toHaveBeenCalled();
  });

  it("skips sending on a retry within the same Manila calendar week", async () => {
    const deps = await makeDepsWithOpenTask();

    await runWeeklyDigestJob(deps, "cohort-5", new Date("2026-08-31T02:00:00Z"));
    deps.sendMessage.mockClear();
    await runWeeklyDigestJob(deps, "cohort-5", new Date("2026-08-31T02:05:00Z"));

    expect(deps.sendMessage).not.toHaveBeenCalled();
  });
});
