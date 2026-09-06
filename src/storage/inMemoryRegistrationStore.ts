import { normalizeUsername } from "../domain/roster.js";
import type { RegistrationStorePort } from "./registrationStorePort.js";

/**
 * In-memory `RegistrationStorePort` implementation: used by tests (and, for
 * now, by production wiring as a placeholder until Supabase is fully wired
 * in — see `SupabaseRegistrationStore`). Data lives only for the lifetime
 * of the process.
 */
export class InMemoryRegistrationStore implements RegistrationStorePort {
  private readonly byTelegramId = new Map<number, string>();
  private readonly byUsername = new Map<string, number>();
  private readonly registeredAtByUsername = new Map<string, string>();

  async register(telegramUserId: number, username: string): Promise<void> {
    const normalized = normalizeUsername(username);
    this.byTelegramId.set(telegramUserId, normalized);
    this.byUsername.set(normalized, telegramUserId);
    this.registeredAtByUsername.set(normalized, new Date().toISOString());
  }

  async findUsername(telegramUserId: number): Promise<string | undefined> {
    return this.byTelegramId.get(telegramUserId);
  }

  async findTelegramId(username: string): Promise<number | undefined> {
    return this.byUsername.get(normalizeUsername(username));
  }

  async findRegisteredAt(username: string): Promise<string | undefined> {
    return this.registeredAtByUsername.get(normalizeUsername(username));
  }
}
