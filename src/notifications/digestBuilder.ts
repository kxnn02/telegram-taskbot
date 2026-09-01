import {
  formatApproved,
  formatBacklog,
  formatBlocked,
  formatMyTasks,
  formatPending,
} from "../bot/format.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { TaskService } from "../service/taskService.js";
import { approvedInPastWeek } from "./weeklyApproved.js";
import type { InternDailyCounts } from "./digestFormat.js";

export interface DigestBuilderDeps {
  service: TaskService;
  roster: Roster;
}

/**
 * Turns already-tested TaskService read queries into the recipient-facing
 * digest text (or `null` when suppressed for having nothing to report), per
 * PRD §8 / issue #2. Deliberately thin: no new business rules, just
 * aggregation + formatting on top of `listMyTasks`, `listPending`,
 * `listBlocked`, `listBacklog`, and `listAllTasks`.
 */
export class DigestBuilder {
  constructor(private readonly deps: DigestBuilderDeps) {}

  /** Daily and weekly individual DM digest for one intern — same shape for
   * both cadences (PRD §8). Returns null when the intern has nothing open. */
  async internDigest(username: string, cohortId: string): Promise<string | null> {
    const caller: Caller = { username, role: "Intern", cohortId };
    const result = await this.deps.service.listMyTasks(caller);
    if (!result.ok || result.value.length === 0) return null;
    return formatMyTasks(result.value);
  }

  /** Daily individual DM digest for one higher-up: pending review, blocked,
   * and overdue, cohort-wide (not scoped to tasks they personally assigned —
   * PRD §2's any-higher-up-any-task rule). Returns null when there's
   * nothing to report. */
  async higherUpDailyDigest(username: string, cohortId: string): Promise<string | null> {
    const caller: Caller = { username, role: "HigherUp", cohortId };
    const pending = await this.deps.service.listPending(caller);
    const blocked = await this.deps.service.listBlocked(caller);
    const overdue = await this.deps.service.listBacklog(caller);

    const pendingTasks = pending.ok ? pending.value : [];
    const blockedTasks = blocked.ok ? blocked.value : [];
    const overdueTasks = overdue.ok ? overdue.value : [];

    if (
      pendingTasks.length === 0 &&
      blockedTasks.length === 0 &&
      overdueTasks.length === 0
    ) {
      return null;
    }

    const sections: string[] = [];
    if (pendingTasks.length > 0) sections.push(formatPending(pendingTasks));
    if (blockedTasks.length > 0) sections.push(formatBlocked(blockedTasks));
    if (overdueTasks.length > 0) sections.push(formatBacklog(overdueTasks));
    return sections.join("\n\n");
  }

  /** Weekly Monday individual DM digest for one higher-up: pending review
   * plus what was Approved in the past 7 days (PRD §8). Returns null when
   * there's nothing to report. */
  async higherUpWeeklyDigest(
    username: string,
    cohortId: string,
    now: Date,
  ): Promise<string | null> {
    const caller: Caller = { username, role: "HigherUp", cohortId };
    const pending = await this.deps.service.listPending(caller);
    const all = await this.deps.service.listAllTasks(caller);

    const pendingTasks = pending.ok ? pending.value : [];
    const approvedTasks = all.ok ? approvedInPastWeek(all.value, now) : [];

    if (pendingTasks.length === 0 && approvedTasks.length === 0) {
      return null;
    }

    const sections: string[] = [];
    if (pendingTasks.length > 0) sections.push(formatPending(pendingTasks));
    if (approvedTasks.length > 0) {
      sections.push(formatApproved(approvedTasks));
    }
    return sections.join("\n\n");
  }

  /** Per-member counts for the daily group-chat summary (PRD §8) — deliberately
   * counts-only, see `InternDailyCounts`. Includes every roster member in the
   * cohort, even ones with zero tasks, for full-cohort visibility — not just
   * interns, since assignment is open to the whole roster (issue #27/#29). */
  async groupDailyCounts(cohortId: string): Promise<InternDailyCounts[]> {
    const members = this.deps.roster.all().filter((entry) => entry.cohortId === cohortId);

    return Promise.all(
      members.map(async (entry) => {
        const caller: Caller = {
          username: entry.username,
          role: entry.role,
          cohortId,
        };
        const result = await this.deps.service.listMyTasks(caller);
        const tasks = result.ok ? result.value : [];
        const overdue = tasks.filter((t) => t.overdue).length;
        const blocked = tasks.filter((t) => t.status === "blocked").length;
        const onTrack = tasks.filter((t) => !t.overdue && t.status !== "blocked").length;
        return { username: entry.username, onTrack, overdue, blocked };
      }),
    );
  }
}
