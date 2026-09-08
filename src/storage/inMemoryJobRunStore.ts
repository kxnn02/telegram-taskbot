import type { JobRunStatus } from "../domain/types.js";
import type { JobRunStorePort } from "./jobRunStorePort.js";

/** In-memory `JobRunStorePort` for fast tests: recorded runs are exposed on
 * `.runs`, in call order, for direct assertions — no fake clock/ids needed
 * since nothing reads them back yet (unlike `InMemoryAlertThrottleStore`,
 * which has to reason about elapsed time). */
export class InMemoryJobRunStore implements JobRunStorePort {
  readonly runs: { jobName: string; status: JobRunStatus; detail: string | null }[] = [];

  async record(jobName: string, status: JobRunStatus, detail: string | null): Promise<void> {
    this.runs.push({ jobName, status, detail });
  }
}
