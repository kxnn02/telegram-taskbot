import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUsername } from "../domain/roster.js";
import type { RegistrationStorePort } from "./registrationStorePort.js";

interface RegistrationRow {
  telegram_user_id: number;
  username: string;
  registered_at: string;
}

/** Real `RegistrationStorePort` implementation over the Supabase
 * `registrations` table (ADR-0006), via the supabase-js query builder. */
export class SupabaseRegistrationStore implements RegistrationStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async register(telegramUserId: number, username: string): Promise<void> {
    const { error } = await this.client.from("registrations").upsert(
      {
        telegram_user_id: telegramUserId,
        username: normalizeUsername(username),
        registered_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" },
    );
    if (error) {
      throw new Error(`register(${telegramUserId}) failed: ${error.message}`);
    }
  }

  async findUsername(telegramUserId: number): Promise<string | undefined> {
    const { data, error } = await this.client
      .from("registrations")
      .select()
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) {
      throw new Error(`findUsername(${telegramUserId}) failed: ${error.message}`);
    }
    return (data as RegistrationRow | null)?.username;
  }

  async findTelegramId(username: string): Promise<number | undefined> {
    const { data, error } = await this.client
      .from("registrations")
      .select()
      .eq("username", normalizeUsername(username))
      .maybeSingle();
    if (error) {
      throw new Error(`findTelegramId(${username}) failed: ${error.message}`);
    }
    return (data as RegistrationRow | null)?.telegram_user_id;
  }
}
