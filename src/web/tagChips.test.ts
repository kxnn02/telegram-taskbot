import { describe, expect, it } from "vitest";
import type { Tag } from "../domain/types.js";
import { visibleTagChips } from "./tagChips.js";

/** Pure chip-overflow logic for a task card's tag row (issue #105 sub-stage
 * 5b) — mirrors Devie's `task.tags?.slice(0, 3)` + `+{tags.length - 3}`
 * overflow chip (`components/kanban/task-card.tsx:92`). */

function makeTags(count: number): Tag[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    cohortId: "cohort-5",
    name: `Tag ${i + 1}`,
    color: "#6366f1",
  }));
}

describe("visibleTagChips", () => {
  it("returns no visible tags and no overflow for zero tags", () => {
    expect(visibleTagChips([])).toEqual({ visible: [], overflowCount: 0 });
  });

  it("shows all tags with no overflow when there are exactly 3", () => {
    const tags = makeTags(3);
    const result = visibleTagChips(tags);
    expect(result.visible).toEqual(tags);
    expect(result.overflowCount).toBe(0);
  });

  it("shows only 3 with an overflow of 1 when there are 4", () => {
    const tags = makeTags(4);
    const result = visibleTagChips(tags);
    expect(result.visible).toEqual(tags.slice(0, 3));
    expect(result.overflowCount).toBe(1);
  });

  it("shows only 3 with the correct overflow for many tags", () => {
    const tags = makeTags(10);
    const result = visibleTagChips(tags);
    expect(result.visible).toEqual(tags.slice(0, 3));
    expect(result.overflowCount).toBe(7);
  });

  it("respects a custom max", () => {
    const tags = makeTags(5);
    const result = visibleTagChips(tags, 2);
    expect(result.visible).toEqual(tags.slice(0, 2));
    expect(result.overflowCount).toBe(3);
  });
});
