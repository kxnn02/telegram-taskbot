import type { RegistrationStorePort } from "../storage/registrationStorePort.js";
import type { OverdueNotificationStorePort } from "../storage/overdueNotificationStorePort.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { TaskService } from "../service/taskService.js";
import { DigestBuilder } from "./digestBuilder.js";
import { findNewOverdueCrossings } from "./overdueCrossing.js";
import { findDueTomorrow } from "./dueSoonReminder.js";

/** All scheduled notifications run on Asia/Manila time (PRD §8/§12), not
 * server-local time. */
export const MANILA_TIMEZONE = "Asia/Manila";

/** Narrow slice of grammy's `Bot` this module actually needs — kept
 * independent of the full grammy `Bot` type so scheduler logic is testable
 * with a plain fake instead of a real bot instance. */
export interface NotifierBot {
  api: {
    /** `other` is optional and unused by anything in this file — widened
     * (issue #107) so a real grammy `Bot` also satisfies
     * `jobs/standupPush.ts`'s `StandupPushBot`, which needs
     * `{ parse_mode: "HTML" }` for the standup push card, without this
     * module's own DM sends (which pass no third argument) changing at
     * all. */
    sendMessage(
      chatId: number | string,
      text: string,
      other?: { parse_mode?: "HTML" },
    ): Promise<unknown>;
  };
}

export interface SchedulerDeps {
  bot: NotifierBot;
  registrations: RegistrationStorePort;
  service: TaskService;
  roster: Roster;
  overdueNotifications: OverdueNotificationStorePort;
}

/** A synthetic caller used only to reach TaskService.listAllTasks so the
 * scheduler can read raw cohort task state. There is no access-control
 * check anywhere in TaskService any more (ADR-0013), so this exists purely
 * to satisfy the method's signature. */
function schedulerCaller(cohortId: string): Caller {
  return { username: "__scheduler__", cohortId };
}

/** Best-effort DM send, mirroring src/bot/notify.ts's notifyUser: silently
 * no-ops if the recipient never ran /start, and never throws — neither on
 * the registration lookup (which can throw, e.g. a duplicated roster
 * handle) nor on delivery failure (e.g. the user blocked the bot). Returns
 * whether a message was actually sent. */
export async function sendDM(
  bot: NotifierBot,
  registrations: RegistrationStorePort,
  username: string,
  text: string,
): Promise<boolean> {
  try {
    const telegramId = await registrations.findTelegramId(username);
    if (!telegramId) return false;
    await bot.api.sendMessage(telegramId, text);
    return true;
  } catch {
    // Best-effort — never let a notification failure propagate.
    return false;
  }
}

/** Overdue-crossing check (PRD §8): notifies both the assignee and the
 * assigner exactly once per task, the first time this check observes it as
 * overdue. Safe to call repeatedly/often — already-notified tasks are
 * skipped via OverdueNotificationRepository. */
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
    try {
      const text = `Task ${task.id} ("${task.title}") is now overdue — it was due ${task.dueDate} and hasn't been submitted.`;
      await sendDM(deps.bot, deps.registrations, task.assigneeUsername, text);
      await sendDM(deps.bot, deps.registrations, task.assignedByUsername, text);
      await deps.overdueNotifications.markNotified(task.cohortId, task.id);
    } catch (err) {
      // Isolate one task's failure so the rest of the crossings still get
      // notified — markNotified above is skipped, so this task is retried
      // on the next run.
      console.error(`runOverdueCrossingCheck: task ${task.id} failed`, err);
    }
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
    try {
      await sendDM(
        deps.bot,
        deps.registrations,
        task.assigneeUsername,
        `Reminder: Task ${task.id} ("${task.title}") is due tomorrow (${task.dueDate}).`,
      );
    } catch (err) {
      console.error(`runDueSoonReminderCheck: task ${task.id} failed`, err);
    }
  }
}

/** Daily 10am standup (PRD §8): individual DMs, suppressed per-recipient
 * when there's nothing to report. The group already has its own cohort-wide
 * view — the 8:05am standup card — so this no longer posts anything to the
 * group chat (#143 D1 / #144). Per #143 D1, a DM is personal: it carries
 * only the recipient's own open tasks, nothing about the rest of the
 * cohort (#145). */
export async function runDailyDigest(
  deps: SchedulerDeps,
  digestBuilder: DigestBuilder,
  cohortId: string,
): Promise<void> {
  const entries = deps.roster.all().filter((e) => e.cohortId === cohortId);
  for (const entry of entries) {
    try {
      const text = await digestBuilder.ownTasksDigest(entry.username, cohortId);
      if (text) {
        await sendDM(
          deps.bot,
          deps.registrations,
          entry.username,
          `Daily digest:\n\n${text}`,
        );
      }
    } catch (err) {
      // Isolate one member's failure so the rest of the roster still gets
      // notified.
      console.error(`runDailyDigest: member ${entry.username} failed`, err);
    }
  }
}

/** Weekly digest (PRD §8, #143 D4b / #147): each member gets what *they*
 * completed in the trailing 7 days — content the daily digest never sends.
 * Suppressed per-recipient when nothing was completed. Deliberately does
 * NOT include the member's still-open tasks: this now sends right after
 * the 8:05am standup card, and an open-tasks section would repeat almost
 * exactly what the same member's 10am daily digest says two hours later on
 * the same Monday — the duplication #143's D1 exists to eliminate. */
export async function runWeeklyDigest(
  deps: SchedulerDeps,
  digestBuilder: DigestBuilder,
  cohortId: string,
  now: Date,
): Promise<void> {
  const entries = deps.roster.all().filter((e) => e.cohortId === cohortId);
  for (const entry of entries) {
    try {
      const text = await digestBuilder.weeklyDigest(entry.username, cohortId, now);
      if (text) {
        await sendDM(
          deps.bot,
          deps.registrations,
          entry.username,
          `Weekly digest:\n\n${text}`,
        );
      }
    } catch (err) {
      console.error(`runWeeklyDigest: member ${entry.username} failed`, err);
    }
  }
}

// `startScheduler` (the node-cron wiring for the four jobs above) was
// removed in Phase 4 (issue #15/ADR-0007): scheduling now lives in
// Supabase `pg_cron` + `pg_net` calling the `/api/jobs/*` endpoints
// (`src/jobs/notificationJobs.ts` wraps these same `run*` functions,
// scoped to one cohort per call rather than looping every roster cohort
// the way this file's removed cron wiring used to). The `run*` functions
// above are unchanged and reused directly by those endpoints.
