import type { DatabaseSync } from "./schema.js";
import { normalizeUsername } from "../domain/roster.js";

interface RegistrationRow {
  telegram_user_id: number;
  username: string;
  registered_at: string;
}

/** Links a Telegram numeric user id to a roster username, once /start has
 * been run (PRD §7). This is what lets the bot resolve "who is this" on
 * every subsequent message without asking again. */
export class RegistrationRepository {
  constructor(private readonly db: DatabaseSync) {}

  register(telegramUserId: number, username: string): void {
    this.db
      .prepare(
        `INSERT INTO registrations (telegram_user_id, username, registered_at)
         VALUES (?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           username = excluded.username,
           registered_at = excluded.registered_at`,
      )
      .run(telegramUserId, normalizeUsername(username), new Date().toISOString());
  }

  findUsername(telegramUserId: number): string | undefined {
    const row = this.db
      .prepare("SELECT * FROM registrations WHERE telegram_user_id = ?")
      .get(telegramUserId) as RegistrationRow | undefined;
    return row?.username;
  }

  /** Reverse lookup used to DM someone by roster username — returns
   * undefined if they've never run /start, since Telegram can't be DM'd
   * without that prior contact (PRD §7/§12). */
  findTelegramId(username: string): number | undefined {
    const row = this.db
      .prepare("SELECT * FROM registrations WHERE username = ?")
      .get(normalizeUsername(username)) as RegistrationRow | undefined;
    return row?.telegram_user_id;
  }
}
