import type { WizardState } from "../bot/wizard.js";

/**
 * Storage port for in-progress `/assign`/`/edit` wizard state (ADR-0006),
 * replacing the plain in-memory `Map` `WizardManager` used to hold this in
 * (documented there as a v1 tradeoff that can't survive serverless: a
 * different disposable Lambda invocation could handle each message
 * mid-wizard, so state has to live somewhere every invocation can reach).
 */
export interface WizardStateStorePort {
  get(telegramUserId: number): Promise<WizardState | undefined>;
  set(telegramUserId: number, state: WizardState): Promise<void>;
  /** Returns whether a row actually existed to delete. */
  delete(telegramUserId: number): Promise<boolean>;
}
