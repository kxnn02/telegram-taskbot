/**
 * Storage port for the `alert_throttle` table (ADR-0007): backs two
 * unrelated-but-structurally-identical idempotency needs on top of the same
 * single-text-key table —
 *
 * - **Digest idempotency**: `claim(key)` is a one-shot atomic claim, exactly
 *   like `ProcessedUpdatesStorePort.claim` — the key already encodes the
 *   period (`digest:{cohortId}:{daily|weekly}:{periodKey}`), so a given key
 *   is only ever claimed once, ever; the next period gets a new key
 *   automatically. Must be one atomic operation, not a `SELECT` then
 *   `INSERT` — a `pg_net` retry racing the original call must not both pass
 *   a "not yet claimed" check.
 * - **Error-DM throttle**: `claimWithWindow(key, windowMs)` claims a *stable*
 *   key (`error:{jobName}:{cohortId}`, deliberately with no timestamp baked
 *   in) but re-permits sending once `windowMs` has elapsed since the last
 *   successful claim — "once per problem, not once per recurrence" without
 *   the alert going silent forever once a job starts failing regularly.
 */
export interface AlertThrottleStorePort {
  /** Attempts to atomically claim a key for the first (and only) time.
   * Returns `true` if this call claimed it, `false` if some earlier call
   * already claimed it. Never reclaimable once claimed — used where the key
   * itself already encodes the one period it should ever fire for. */
  claim(key: string): Promise<boolean>;

  /** Attempts to claim a key that may be reclaimed after `windowMs` has
   * elapsed since the last successful claim. Returns `true` if this call
   * should proceed (first-ever claim, or the window has elapsed), `false`
   * if the key was already claimed within the window. */
  claimWithWindow(key: string, windowMs: number): Promise<boolean>;
}
