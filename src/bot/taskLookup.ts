import { parseTaskRef } from "./taskRef.js";
import type { Task } from "../domain/types.js";

/** Cap on how many candidates an ambiguous keyword search reports (Devie's
 * `route.ts:434-453` @ `453d1a7`). */
const MAX_MATCHES = 5;

export type TaskLookup =
  | { kind: "found"; task: Task }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: Task[] };

/**
 * Resolves a `/done`/`/complete`/`/update` ref argument against `tasks`,
 * Devie's way (issue #124 stage S1, `route.ts:434-453`): a numeric ref
 * (`23`, `t23`, `T-023`) is looked up by id first, and a miss there is a
 * miss — it never falls through to a keyword search. Otherwise every task
 * whose title contains `input` as a case-insensitive substring is a
 * candidate, except `done` ones, sorted newest-first and capped at 5.
 */
export function findTaskByRef(tasks: Task[], input: string): TaskLookup {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: "none" };

  const numericId = parseTaskRef(trimmed);
  if (numericId !== undefined) {
    const byId = tasks.find((t) => t.id === numericId);
    return byId ? { kind: "found", task: byId } : { kind: "none" };
  }

  const needle = trimmed.toLowerCase();
  const matches = tasks
    .filter((t) => t.status !== "done" && t.title.toLowerCase().includes(needle))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, MAX_MATCHES);

  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "found", task: matches[0]! };
  return { kind: "ambiguous", matches };
}
