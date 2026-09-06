import type { Tag } from "../domain/types.js";
import type { TagStorePort } from "./tagStorePort.js";

/**
 * In-memory implementation of `TagStorePort` (mirrors `InMemoryTaskStore`'s
 * shape/conventions) — used by tests, never by production wiring. Data lives
 * only for the lifetime of the process.
 */
export class InMemoryTagStore implements TagStorePort {
  private readonly tags = new Map<number, Tag>();
  private readonly taskTags = new Map<string, Set<number>>();
  private nextTagId = 1;

  private taskKey(cohortId: string, taskId: number): string {
    return `${cohortId}:${taskId}`;
  }

  async listTagsByCohort(cohortId: string): Promise<Tag[]> {
    return [...this.tags.values()]
      .filter((t) => t.cohortId === cohortId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ ...t }));
  }

  async createTag(cohortId: string, name: string, color: string): Promise<Tag> {
    const tag: Tag = { id: this.nextTagId++, cohortId, name, color };
    this.tags.set(tag.id, tag);
    return { ...tag };
  }

  async listTaskTagIdsByCohort(cohortId: string): Promise<Map<number, number[]>> {
    const result = new Map<number, number[]>();
    for (const [key, tagIds] of this.taskTags.entries()) {
      const [rowCohortId, taskIdStr] = key.split(":");
      if (rowCohortId !== cohortId) continue;
      result.set(Number(taskIdStr), [...tagIds].sort((a, b) => a - b));
    }
    return result;
  }

  async setTaskTags(cohortId: string, taskId: number, tagIds: number[]): Promise<void> {
    this.taskTags.set(this.taskKey(cohortId, taskId), new Set(tagIds));
  }
}
