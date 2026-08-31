/**
 * Storage port for webhook-delivery dedup (ADR-0004): Telegram retries an
 * update if the webhook doesn't respond fast/successfully, so the same
 * `update_id` can arrive twice. `claim` must be one atomic operation, not a
 * `SELECT` followed by an `INSERT` — two concurrent retries of the same
 * update could otherwise both pass a "not yet processed" check before
 * either finishes writing, defeating the dedup entirely.
 */
export interface ProcessedUpdatesStorePort {
  /** Attempts to atomically claim an update id. Returns `true` if this call
   * was the one that claimed it (the caller should process the update);
   * `false` if it was already claimed by an earlier delivery (the caller
   * should treat this as a no-op). */
  claim(updateId: number): Promise<boolean>;
}
