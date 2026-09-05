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

/** Combines a member's own open-task digest with the cohort-wide oversight
 * digest (ADR-0013 — there is no role tier to split these by any more,
 * so every member gets both halves) — without this, a member holding an
 * assigned task would never see it, only ever the oversight view. `null`
 * only when both halves have nothing to report. */
async function memberCombinedDigest(
  digestBuilder: DigestBuilder,
  username: string,
  cohortId: string,
  oversight: () => Promise<string | null>,
): Promise<string | null> {
  const own = await digestBuilder.ownTasksDigest(username, cohortId);
  const oversightText = await oversight();
  const parts = [own, oversightText].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join("\n\n");
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
    try {
      const text = await memberCombinedDigest(digestBuilder, entry.username, cohortId, () =>
        digestBuilder.oversightDailyDigest(entry.username, cohortId),
      );
      if (text) {
        await sendDM(
          deps.bot,
          deps.registrations,
          entry.username,
          `Daily digest:\n\n${text}`,
        );
      }
    } catch (err) {
      // Isolate one member's failure so the rest of the roster, and the
      // group-chat summary below, still go out.
      console.error(`runDailyDigest: member ${entry.username} failed`, err);
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

/** Weekly Monday digest (PRD §8): every member gets their own open tasks
 * plus pending review and what was marked done in the past week (ADR-0013
 * — no role split). Suppressed per-recipient when there's nothing to
 * report. */
export async function runWeeklyDigest(
  deps: SchedulerDeps,
  digestBuilder: DigestBuilder,
  cohortId: string,
  now: Date,
): Promise<void> {
  const entries = deps.roster.all().filter((e) => e.cohortId === cohortId);
  for (const entry of entries) {
    try {
      const text = await memberCombinedDigest(digestBuilder, entry.username, cohortId, () =>
        digestBuilder.oversightWeeklyDigest(entry.username, cohortId, now),
      );
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
