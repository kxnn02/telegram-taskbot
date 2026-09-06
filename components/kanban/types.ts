import type { Tag, Task } from "@/src/domain/types";

/** The shape `GET /api/board` returns (issue #105 sub-stage 5b) — a task
 * plus its resolved tags, matching `TagService.listTasksWithTags`'s return
 * type. Shared by every kanban component so they don't each redeclare it. */
export type BoardTask = Task & { tags: Tag[] };
