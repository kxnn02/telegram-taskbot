import { formatMyTasks, formatWeeklyCompleted } from "../bot/format.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { TaskService } from "../service/taskService.js";
import { approvedInPastWeek } from "./weeklyApproved.js";

export interface DigestBuilderDeps {
  service: TaskService;
  roster: Roster;
}

/**
 * Turns already-tested TaskService read queries into the recipient-facing
 * digest text (or `null` when suppressed for having nothing to report), per
 * PRD §8 / issue #2, and #143's D1: a DM is personal — it says what the
 * recipient has to do, nothing about the rest of the cohort.
 */
export class DigestBuilder {
  constructor(private readonly deps: DigestBuilderDeps) {}

  /** Own-open-tasks digest — the daily digest's shape (PRD §8, #145).
   * Returns null when the member has nothing open. */
  async ownTasksDigest(username: string, cohortId: string): Promise<string | null> {
    const caller: Caller = { username, cohortId };
    const result = await this.deps.service.listMyTasks(caller);
    if (!result.ok || result.value.length === 0) return null;
    return formatMyTasks(result.value);
  }

  /** Weekly digest content (#143 D4b / #147): completed-this-week only, not
   * the open-tasks list `ownTasksDigest` already sends daily — "still open"
   * was dropped because the weekly digest now sends right after the 8:05am
   * standup card, and would otherwise repeat almost exactly what that same
   * member's 10am daily digest says two hours later on the same Monday.
   * Returns null when the member completed nothing in the trailing 7 days
   * from `now`. */
  async weeklyDigest(
    username: string,
    cohortId: string,
    now: Date,
  ): Promise<string | null> {
    const caller: Caller = { username, cohortId };
    const result = await this.deps.service.listTasksForMember(caller, username);
    if (!result.ok) return null;
    const completed = approvedInPastWeek(result.value, now);
    if (completed.length === 0) return null;
    return formatWeeklyCompleted(completed);
  }
}
