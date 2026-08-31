/**
 * Storage port for the Telegram-user-id <-> roster-username link created by
 * `/start` (PRD §7). Kept separate from `TaskStorePort` (see that file's doc
 * comment): registrations are used directly by the bot layer
 * (`callerResolution.ts`, `notify.ts`) and the scheduler, never by
 * `TaskService`.
 */
export interface RegistrationStorePort {
  register(telegramUserId: number, username: string): Promise<void>;
  findUsername(telegramUserId: number): Promise<string | undefined>;
  /** Reverse lookup used to DM someone by roster username — returns
   * undefined if they've never run /start, since Telegram can't be DM'd
   * without that prior contact (PRD §7/§12). */
  findTelegramId(username: string): Promise<number | undefined>;
}
