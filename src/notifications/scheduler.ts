import cron from "node-cron";
import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { OverdueNotificationStorePort } from "../storage/overdueNotificationStorePort.js";
import type { CohortStorePort } from "../storage/cohortStorePort.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { TaskService } from "../service/taskService.js";
import { DigestBuilder } from "./digestBuilder.js";
import { findNewOverdueCrossings } from "./overdueCrossing.js";
import { findDueTomorrow } from "./dueSoonReminder.js";
import { formatGroupDailySummary } from "./digestFormat.js";

/** All scheduled notifications run on Asia/Manila time (PRD §8/§12), not
 * server-local time. */
export const MANILA_TIMEZONE = "Asia/Manila";

/** Narrow slice of grammy's `Bot` this module actually needs — kept
 * independent of the full grammy `Bot` type so scheduler logic is testable
 * with a plain fake instead of a real bot instance. */
export interface NotifierBot {
  api: {
    sendMessage(chatId: number | string, text: string): Promise<unknown>;
  };
}

export interface SchedulerDeps {
  bot: NotifierBot;
  registrations: RegistrationStorePort;
  service: TaskService;
  roster: Roster;
  overdueNotifications: OverdueNotificationStorePort;
  /** Per-cohort Telegram group chat id lookup (ADR-0006), replacing the old
   * single global `GROUP_CHAT_ID` — the real cohort and the dry-run cohort
   * each have their own group. Digests/reminders still run without one
   * configured for a given cohort — only that cohort's group-chat post is
   * skipped. */
  cohorts: CohortStorePort;
}

function cohortIds(roster: Roster): string[] {
  return [...new Set(roster.all().map((entry) => entry.cohortId))];
}

/** A synthetic caller used only to reach TaskService.listAllTasks (which
 * isn't role-restricted — it returns the whole cohort regardless of caller
 * role) so the scheduler can read raw cohort task state. Never used for
 * anything that enforces a permission check. */
function schedulerCaller(cohortId: string): Caller {
  return { username: "__scheduler__", role: "HigherUp", cohortId };
}

/** Best-effort DM send, mirroring src/bot/notify.ts's notifyUser: silently
 * no-ops if the recipient never ran /start, and never throws on delivery
 * failure (e.g. the user blocked the bot). */
export async function sendDM(
  bot: NotifierBot,
  registrations: RegistrationStorePort,
  username: string,
  text: string,
): Promise<void> {
  const telegramId = await registrations.findTelegramId(username);
  if (!telegramId) return;
  try {
    await bot.api.sendMessage(telegramId, text);
  } catch {
    // Best-effort — never let a notification failure propagate.
  }
}

/** Overdue-crossing check (PRD §8): notifies both the intern and the
 * assigning higher-up exactly once per task, the first time this check
 * observes it as overdue. Safe to call repeatedly/often — already-notified
 * tasks are skipped via OverdueNotificationRepository. */
export async function runOverdueCrossingCheck(
  deps: SchedulerDeps,
  cohortId: string,
  now: Date,
): Promise<void> {
  const result = await deps.service.listAllTasks(schedulerCaller(cohortId));
  const tasks = result.ok ? result.value : [];
  const crossings = await findNewOverdueCrossings(tasks, now, (c, id) =>
    deps.overdueNotifications.hasNotified(c, id),
  );
  for (const task of crossings) {
    const text = `Task ${task.id} ("${task.title}") is now overdue — it was due ${task.dueDate} and hasn't been submitted.`;
    await sendDM(deps.bot, deps.registrations, task.assigneeUsername, text);
    await sendDM(deps.bot, deps.registrations, task.assignedByUsername, text);
    await deps.overdueNotifications.markNotified(task.cohortId, task.id);
  }
}

/** Due-date reminder (PRD §8): ~1 day before due date, to the assignee. */
export async function runDueSoonReminderCheck(
  deps: SchedulerDeps,
  cohortId: string,
  now: Date,
): Promise<void> {
  const result = await deps.service.listAllTasks(schedulerCaller(cohortId));
  const tasks = result.ok ? result.value : [];
  const dueSoon = findDueTomorrow(tasks, now);
  for (const task of dueSoon) {
    await sendDM(
      deps.bot,
      deps.registrations,
      task.assigneeUsername,
      `Reminder: Task ${task.id} ("${task.title}") is due tomorrow (${task.dueDate}).`,
    );
  }
}

/** Daily 10am standup (PRD §8): individual DMs (suppressed when nothing to
 * report) plus one counts-only group-chat summary. */
export async function runDailyDigest(
  deps: SchedulerDeps,
  digestBuilder: DigestBuilder,
  cohortId: string,
): Promise<void> {
  const entries = deps.roster.all().filter((e) => e.cohortId === cohortId);
  for (const entry of entries) {
    const text =
      entry.role === "Intern"
        ? await digestBuilder.internDigest(entry.username, cohortId)
        : await digestBuilder.higherUpDailyDigest(entry.username, cohortId);
    if (text) {
      await sendDM(
        deps.bot,
        deps.registrations,
        entry.username,
        `Daily digest:\n\n${text}`,
      );
    }
  }

  const groupChatId = await deps.cohorts.getGroupChatId(cohortId);
  if (groupChatId) {
    const counts = await digestBuilder.groupDailyCounts(cohortId);
    const summary = formatGroupDailySummary(counts);
    try {
      await deps.bot.api.sendMessage(groupChatId, summary);
    } catch {
      // Best-effort, same as DM delivery.
    }
  }
}

/** Weekly Monday digest (PRD §8): interns get open tasks (same shape as the
 * daily individual digest); higher-ups get pending review plus what was
 * Approved in the past week. Suppressed per-recipient when there's nothing
 * to report. */
export async function runWeeklyDigest(
  deps: SchedulerDeps,
  digestBuilder: DigestBuilder,
  cohortId: string,
  now: Date,
): Promise<void> {
  const entries = deps.roster.all().filter((e) => e.cohortId === cohortId);
  for (const entry of entries) {
    const text =
      entry.role === "Intern"
        ? await digestBuilder.internDigest(entry.username, cohortId)
        : await digestBuilder.higherUpWeeklyDigest(entry.username, cohortId, now);
    if (text) {
      await sendDM(
        deps.bot,
        deps.registrations,
        entry.username,
        `Weekly digest:\n\n${text}`,
      );
    }
  }
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * Wires the four notification jobs onto Asia/Manila cron schedules. This
 * function itself is a thin integration layer — the acceptance-criteria-load-
 * bearing logic it calls (findNewOverdueCrossings, findDueTomorrow,
 * DigestBuilder, formatGroupDailySummary) is unit-tested independently at
 * the service/query level; this wiring is the "thinner, separately-verified
 * integration concern" issue #2 calls out.
 */
export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  const digestBuilder = new DigestBuilder({
    service: deps.service,
    roster: deps.roster,
  });

  const tasks = [
    // Overdue-crossing: checked hourly. A due date is day-granularity, so
    // the crossing itself happens once at midnight Manila time; hourly
    // polling catches it promptly without needing a sub-hourly job for an
    // ~8-person cohort bot, and re-checks are cheap no-ops thanks to
    // OverdueNotificationRepository's one-time tracking.
    cron.schedule(
      "0 * * * *",
      () => {
        const now = new Date();
        for (const cohortId of cohortIds(deps.roster)) {
          void runOverdueCrossingCheck(deps, cohortId, now);
        }
      },
      { timezone: MANILA_TIMEZONE },
    ),
    // Due-date reminder: once daily, ahead of the 10am digest.
    cron.schedule(
      "0 9 * * *",
      () => {
        const now = new Date();
        for (const cohortId of cohortIds(deps.roster)) {
          void runDueSoonReminderCheck(deps, cohortId, now);
        }
      },
      { timezone: MANILA_TIMEZONE },
    ),
    // Daily standup digest: 10am every day.
    cron.schedule(
      "0 10 * * *",
      () => {
        for (const cohortId of cohortIds(deps.roster)) {
          void runDailyDigest(deps, digestBuilder, cohortId);
        }
      },
      { timezone: MANILA_TIMEZONE },
    ),
    // Weekly digest: Monday 10am, alongside (not instead of) that day's
    // daily digest — the two are deliberately separate PRD §8 features.
    cron.schedule(
      "0 10 * * 1",
      () => {
        const now = new Date();
        for (const cohortId of cohortIds(deps.roster)) {
          void runWeeklyDigest(deps, digestBuilder, cohortId, now);
        }
      },
      { timezone: MANILA_TIMEZONE },
    ),
  ];

  return {
    stop() {
      for (const task of tasks) task.stop();
    },
  };
}
