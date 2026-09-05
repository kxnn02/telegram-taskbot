// Shapes DevieBot's language parser (lib/nlp.ts) produces, ported behind
// our own domain types (issue #102) rather than DevieBot's string literals.
// DevieBot's per-event intents don't exist here — this repo has no
// equivalent event-grouping concept.
import type { TaskPriority, TaskStatus } from "../domain/types.js";

export interface BulkTask {
  /** Raw, unresolved username from the pasted message — the caller (stage
   * 4) resolves this against the roster; an unresolvable name is that
   * caller's error to raise, not this parser's. */
  assignee: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  dueDate?: string | null;
}

export interface BulkUpdate {
  /** Keyword or number identifying the task, e.g. "login bug" or "23". */
  taskRef: string;
  status: TaskStatus;
}

export type ParsedIntent =
  | {
      intent: "addtask";
      title: string;
      priority?: TaskPriority;
      assignedTo?: string;
      dueDate?: string | null;
    }
  | { intent: "update"; taskId: number | null; status: TaskStatus }
  | { intent: "done"; taskId: number | null }
  | { intent: "standup" }
  | { intent: "tasks" }
  | { intent: "help" }
  | { intent: "unknown"; reply: string };

/** A task summary the model can reference by its sequential, per-cohort
 * number (our `Task.id`) — unlike DevieBot's UUIDs, no truncated-id
 * guessing is needed. */
export interface ParseMessageTaskSummary {
  id: number;
  title: string;
  status: TaskStatus;
}

export interface ParseMessageContext {
  recentTasks: ParseMessageTaskSummary[];
}
