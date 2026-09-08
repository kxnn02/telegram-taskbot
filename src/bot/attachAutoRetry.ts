import { autoRetry } from "@grammyjs/auto-retry";
import type { Bot } from "grammy";

/**
 * Installs grammy's official auto-retry transformer on a bot instance.
 * Without this, a Telegram `429` (or a transient `5xx`) is an immediate
 * thrown `GrammyError` at every call site — the failure mode that produced
 * "Failed to send test standup" from a flood-controlled dump group, and the
 * same risk exists for `/addtask @all` fanning out to a large roster, or a
 * scheduled job landing close to another one. This wraps every `bot.api.*`
 * call so a rate-limited send waits out `retry_after` and retries instead of
 * failing outright.
 *
 * `maxRetryAttempts`/`maxDelaySeconds` cap the wait so a genuinely broken
 * chat (banned bot, deleted group) still fails a request in bounded time
 * rather than hanging it — Telegram's `retry_after` can legitimately be
 * minutes long under sustained flood control.
 */
export function attachAutoRetry(
  bot: Bot,
  options?: { maxRetryAttempts?: number; maxDelaySeconds?: number },
): void {
  bot.api.config.use(
    autoRetry({
      maxRetryAttempts: options?.maxRetryAttempts ?? 3,
      maxDelaySeconds: options?.maxDelaySeconds ?? 30,
    }),
  );
}
