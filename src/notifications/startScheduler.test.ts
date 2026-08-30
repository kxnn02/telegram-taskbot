import { describe, expect, it, vi } from "vitest";

const scheduleMock = vi.fn((..._args: unknown[]) => ({ stop: vi.fn() }));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleMock },
}));

// Imported after the mock so startScheduler picks up the mocked node-cron.
const { startScheduler, MANILA_TIMEZONE } = await import("./scheduler.js");

import { openDatabase } from "../db/schema.js";
import { OverdueNotificationRepository } from "../db/overdueNotificationRepository.js";
import { RegistrationRepository } from "../db/registrationRepository.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import type { SchedulerDeps } from "./scheduler.js";

function makeDeps(): SchedulerDeps {
  const db = openDatabase(":memory:");
  const roster = new Roster([
    { username: "alice", role: "Intern", cohortId: "cohort-5" },
  ]);
  const service = new TaskService(db, roster, new FixedClock(new Date()));
  return {
    bot: { api: { sendMessage: vi.fn() } },
    registrations: new RegistrationRepository(db),
    service,
    roster,
    overdueNotifications: new OverdueNotificationRepository(db),
    groupChatId: "-100999",
  };
}

describe("startScheduler cron wiring", () => {
  it("schedules exactly the due-date-reminder, daily-digest, weekly-digest, and overdue-check cron jobs, all on Asia/Manila time", () => {
    scheduleMock.mockClear();
    const handle = startScheduler(makeDeps());

    expect(MANILA_TIMEZONE).toBe("Asia/Manila");
    expect(scheduleMock).toHaveBeenCalledTimes(4);

    const expressions = scheduleMock.mock.calls.map((call) => call[0]);
    expect(expressions).toContain("0 * * * *"); // overdue-crossing, hourly
    expect(expressions).toContain("0 9 * * *"); // due-date reminder, 9am
    expect(expressions).toContain("0 10 * * *"); // daily digest, 10am
    expect(expressions).toContain("0 10 * * 1"); // weekly digest, Monday 10am

    for (const call of scheduleMock.mock.calls) {
      expect(call[2]).toEqual({ timezone: "Asia/Manila" });
    }

    handle.stop();
  });
});
