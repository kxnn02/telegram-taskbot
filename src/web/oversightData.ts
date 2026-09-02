import type { Caller, ServiceResult } from "../domain/types.js";
import type { TaskService, TaskWithFlags } from "../service/taskService.js";
import {
  STATUS_GROUPS,
  filterByStatusGroup,
  type StatusGroup,
} from "./taskView.js";

/**
 * Data-fetching + query-parsing for the Next.js oversight page (Phase 6.1 /
 * issue #17), factored out of the RSC itself so it's directly unit-testable
 * — mirrors the removed Express dashboard's `GET /` handler's query-parsing and
 * filtering logic, minus the Express req/res plumbing. No authorization is
 * done here or in `TaskService.listAllTasks`, and that's intentional
 * (ADR-0009 / issue #28): every roster member sees every task in the
 * cohort, notes and all — this is the same cohort-wide read the bot's
 * `/tasks` already gives interns, so the web view isn't stricter. The
 * dashboard's one login gate is roster/cohort membership (R6/#91); nothing
 * here is role-scoped.
 */

export type GroupMode = "action" | "intern";
const GROUP_MODES: GroupMode[] = ["action", "intern"];

export interface OversightQuery {
  status?: string;
  assignee?: string;
  group?: string;
}

export interface OversightView {
  /** Tasks after status/assignee filtering — what the page actually
   * renders in its sections/panels. */
  tasks: TaskWithFlags[];
  /** The full, unfiltered result of listAllTasks — used to build the
   * assignee chip list, same as the Express dashboard. */
  allTasks: TaskWithFlags[];
  groupMode: GroupMode;
  statusGroup: StatusGroup | undefined;
  assignee: string | undefined;
}

export async function loadOversightView(
  service: TaskService,
  caller: Caller,
  query: OversightQuery,
): Promise<ServiceResult<OversightView>> {
  const result = await service.listAllTasks(caller);
  if (!result.ok) {
    return result;
  }

  const statusGroup =
    query.status !== undefined && (STATUS_GROUPS as string[]).includes(query.status)
      ? (query.status as StatusGroup)
      : undefined;
  const assignee = query.assignee || undefined;
  const groupMode: GroupMode =
    query.group !== undefined && (GROUP_MODES as string[]).includes(query.group)
      ? (query.group as GroupMode)
      : "action";

  let tasks = filterByStatusGroup(result.value, statusGroup);
  if (assignee) {
    tasks = tasks.filter((t) => t.assigneeUsername === assignee);
  }

  return {
    ok: true,
    value: { tasks, allTasks: result.value, groupMode, statusGroup, assignee },
  };
}
