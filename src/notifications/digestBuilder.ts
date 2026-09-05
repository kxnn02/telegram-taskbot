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
import type { MemberDailyCounts } from "./digestFormat.js";

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
 *
 * There is no role tier any more (ADR-0013), so every roster member gets
 * the same shape of digest: their own open tasks plus the cohort-wide
 * oversight view (pending review, blocked, overdue) — previously the
 * oversight half was higher-up-only.
 */
export class DigestBuilder {
  constructor(private readonly deps: DigestBuilderDeps) {}

  /** Own-open-tasks digest — same shape for daily and weekly cadences (PRD
   * §8). Returns null when the member has nothing open. */
  async ownTasksDigest(username: string, cohortId: string): Promise<string | null> {
    const caller: Caller = { username, cohortId };
    const result = await this.deps.service.listMyTasks(caller);
    if (!result.ok || result.value.length === 0) return null;
    return formatMyTasks(result.value);
  }

  /** Daily oversight digest: pending review, blocked, and overdue,
   * cohort-wide (not scoped to tasks the member personally assigned).
   * Returns null when there's nothing to report. */
  async oversightDailyDigest(username: string, cohortId: string): Promise<string | null> {
    const caller: Caller = { username, cohortId };
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

  /** Weekly Monday oversight digest: pending review plus what was marked
   * done in the past 7 days (PRD §8). Returns null when there's nothing to
   * report. */
  async oversightWeeklyDigest(
    username: string,
    cohortId: string,
    now: Date,
  ): Promise<string | null> {
    const caller: Caller = { username, cohortId };
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

  /** Per-member counts for the daily group-chat summary (PRD §8) —
   * deliberately counts-only, see `MemberDailyCounts`. Includes every
   * roster member in the cohort, even ones with zero tasks, for
   * full-cohort visibility. */
  async groupDailyCounts(cohortId: string): Promise<MemberDailyCounts[]> {
    const members = this.deps.roster.all().filter((entry) => entry.cohortId === cohortId);

    return Promise.all(
      members.map(async (entry) => {
        const caller: Caller = { username: entry.username, cohortId };
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
