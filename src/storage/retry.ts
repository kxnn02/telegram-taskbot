export interface RetryOptions {
  attempts?: number;   // total attempts including the first; default 3
  baseDelayMs?: number; // default 250
}

/**
 * True when an error looks like a transient infrastructure failure that a
 * retry could plausibly fix, rather than a bug or a bad query.
 */
export function isTransientError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (typeof error !== "object" || !("message" in error) || typeof error.message !== "string") {
    return false;
  }

  const message = error.message.toLowerCase();
  const transientPatterns = [
    "timeout",
    "timed out",
    "gateway",
    "fetch failed",
    "network",
    "econnreset",
    "etimedout",
    "econnrefused",
    "socket hang up",
    "503",
    "504",
  ];

  return transientPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Runs `fn`, retrying on transient failures with exponential backoff.
 * Non-transient errors are rethrown immediately, without retrying.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const attempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 250;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const isTransient = isTransientError(err);

      if (!isTransient) {
        // Non-transient error: rethrow immediately
        throw err;
      }

      if (attempt === attempts) {
        // All attempts exhausted: rethrow the last error unchanged
        throw err;
      }

      // Transient error with attempts remaining: wait then retry
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      const jitterMs = Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, delayMs + jitterMs));
    }
  }

  // This should never be reached
  throw new Error("withRetry internal error: loop exited without returning or throwing");
}
