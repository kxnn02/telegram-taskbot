import type { Tag } from "../domain/types.js";

/**
 * Pure chip-overflow logic for a task card's tag row (issue #105 sub-stage
 * 5b) — mirrors Devie's `task.tags?.slice(0, 3)` + `+{tags.length - 3}`
 * overflow chip (`components/kanban/task-card.tsx:92`).
 */
export function visibleTagChips(
  tags: Tag[],
  max = 3,
): { visible: Tag[]; overflowCount: number } {
  return {
    visible: tags.slice(0, max),
    overflowCount: Math.max(0, tags.length - max),
  };
}
