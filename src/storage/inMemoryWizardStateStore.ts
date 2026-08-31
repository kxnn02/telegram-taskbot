import type { WizardState } from "../bot/wizard.js";
import type { WizardStateStorePort } from "./wizardStateStorePort.js";

/** In-memory `WizardStateStorePort` implementation: used by tests in place
 * of the real Supabase-backed store. Same shape/behavior the old plain
 * `Map` inside `WizardManager` had, just moved behind the port. */
export class InMemoryWizardStateStore implements WizardStateStorePort {
  private readonly states = new Map<number, WizardState>();

  async get(telegramUserId: number): Promise<WizardState | undefined> {
    return this.states.get(telegramUserId);
  }

  async set(telegramUserId: number, state: WizardState): Promise<void> {
    this.states.set(telegramUserId, state);
  }

  async delete(telegramUserId: number): Promise<boolean> {
    return this.states.delete(telegramUserId);
  }
}
