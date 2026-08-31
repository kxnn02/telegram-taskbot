import type { ProcessedUpdatesStorePort } from "./processedUpdatesStorePort.js";

/** In-memory `ProcessedUpdatesStorePort` implementation for fast tests. Not
 * genuinely concurrency-safe across separate processes (a plain `Set`
 * check-then-add), which is fine for single-process test use — the real
 * atomicity guarantee is exercised against Postgres by the live adapter
 * test. */
export class InMemoryProcessedUpdatesStore implements ProcessedUpdatesStorePort {
  private readonly claimed = new Set<number>();

  async claim(updateId: number): Promise<boolean> {
    if (this.claimed.has(updateId)) return false;
    this.claimed.add(updateId);
    return true;
  }
}
