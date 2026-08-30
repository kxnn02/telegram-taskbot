import { randomBytes } from "node:crypto";
import type { Caller } from "../domain/types.js";

interface SessionRecord {
  caller: Caller;
  expiresAt: number;
}

export interface SessionStoreOptions {
  /** How long a session stays valid, in ms. Default 12h — a dashboard
   * login session, not a long-lived "remember me". */
  ttlMs?: number;
  /** Injectable clock for tests; defaults to Date.now. */
  clock?: () => number;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * In-memory session store mapping an opaque token (set as a cookie) to the
 * logged-in Caller. Deliberately in-memory rather than DB-backed: this is a
 * ~8-person internal tool on a single free-tier instance (PRD §12), so a
 * restart forcing a re-login is an acceptable tradeoff for the simplicity of
 * not adding a sessions table/cleanup job.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.clock = options.clock ?? Date.now;
  }

  create(caller: Caller): string {
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, { caller, expiresAt: this.clock() + this.ttlMs });
    return token;
  }

  get(token: string): Caller | undefined {
    const record = this.sessions.get(token);
    if (!record) return undefined;
    if (this.clock() >= record.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }
    return record.caller;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }
}
