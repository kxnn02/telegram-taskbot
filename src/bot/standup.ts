import type { TaskService, TaskWithFlags } from "../service/taskService.js";
import type { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { formatTaskLine } from "./format.js";

/**
 * `/standup`'s own report shape (issue #33) — deliberately distinct from
 * `InternDailyCounts` (`src/notifications/digestFormat.ts`): that type is
 * counts-only by construction so the automated daily/weekly group digest
 * can never leak a task title. `/standup` is *pulled*, not pushed — someone
 * explicitly ran the command — so it's allowed to carry titles, but only
 * because it's built on this separate type rather than by widening the
 * digest's.
 */
export interface StandupMemberEntry {
  username: string;
  tasks: TaskWithFlags[];
}

/** Every roster member of the caller's cohort, paired with their open
 * (non-`done`) tasks — including members with zero, for full-cohort
 * visibility matching `digestBuilder.groupDailyCounts`'s roster coverage. */
export async function buildStandup(
  service: TaskService,
  roster: Roster,
  caller: Caller,
): Promise<StandupMemberEntry[]> {
  const members = roster.all().filter((entry) => entry.cohortId === caller.cohortId);
  const all = await service.listAllTasks(caller);
  const tasks = all.ok ? all.value : [];
  return members.map((member) => ({
    username: member.username,
    tasks: tasks.filter(
      (t) => t.assigneeUsername === member.username && t.status !== "done",
    ),
  }));
}

/** Renders the `/standup` report. Its own formatter — see `StandupMemberEntry`
 * for why it must not call the digest's `formatGroupDailySummary`. */
export function formatStandup(entries: StandupMemberEntry[]): string {
  if (entries.length === 0) {
    return "No roster members in this cohort yet.";
  }
  const lines = entries.map((entry) => {
    if (entry.tasks.length === 0) {
      return `@${entry.username}: no open tasks`;
    }
    const taskLines = entry.tasks.map((t) => "  - " + formatTaskLine(t));
    return `@${entry.username}:\n${taskLines.join("\n")}`;
  });
  return ["Standup:", ...lines].join("\n\n");
}
