import type { AlertThrottleStorePort } from "./alertThrottleStorePort.js";

/** In-memory `AlertThrottleStorePort` implementation for fast tests. Not
 * genuinely concurrency-safe across separate processes (a plain `Map`
 * check-then-set), which is fine for single-process test use — the real
 * atomicity guarantee is exercised against Postgres by the live adapter
 * test. */
export class InMemoryAlertThrottleStore implements AlertThrottleStorePort {
  private readonly claimed = new Map<string, Date>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async claim(key: string): Promise<boolean> {
    if (this.claimed.has(key)) return false;
    this.claimed.set(key, this.now());
    return true;
  }

  async claimWithWindow(key: string, windowMs: number): Promise<boolean> {
    const lastClaimedAt = this.claimed.get(key);
    const now = this.now();
    if (lastClaimedAt && now.getTime() - lastClaimedAt.getTime() < windowMs) {
      return false;
    }
    this.claimed.set(key, now);
    return true;
  }
}
