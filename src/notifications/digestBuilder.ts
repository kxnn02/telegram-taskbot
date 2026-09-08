import { formatMyTasks } from "../bot/format.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import type { TaskService } from "../service/taskService.js";

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

  /** Own-open-tasks digest — same shape for daily and weekly cadences (PRD
   * §8). Returns null when the member has nothing open. */
  async ownTasksDigest(username: string, cohortId: string): Promise<string | null> {
    const caller: Caller = { username, cohortId };
    const result = await this.deps.service.listMyTasks(caller);
    if (!result.ok || result.value.length === 0) return null;
    return formatMyTasks(result.value);
  }
}
