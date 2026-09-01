import { describe, expect, it, vi } from "vitest";
import { InMemoryAlertThrottleStore } from "../storage/inMemoryAlertThrottleStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { notifyJobFailure, ERROR_THROTTLE_WINDOW_MS } from "./notifyJobFailure.js";

function makeDeps() {
  const registrations = new InMemoryRegistrationStore();
  const bot = { api: { sendMessage: vi.fn() } };
  const throttle = new InMemoryAlertThrottleStore();
  return { bot, registrations, throttle };
}

describe("notifyJobFailure", () => {
  it("DMs the maintainer with the job name, cohort, and error message", async () => {
    const { bot, registrations, throttle } = makeDeps();
    await registrations.register(999, "maintainer");

    await notifyJobFailure(
      { bot, registrations, throttle, maintainerUsername: "maintainer" },
      "daily-digest",
      "cohort-5",
      new Error("boom"),
    );

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const call = bot.api.sendMessage.mock.calls[0]!;
    const [chatId, text] = call;
    expect(chatId).toBe(999);
    expect(text).toContain("daily-digest");
    expect(text).toContain("cohort-5");
    expect(text).toContain("boom");
  });

  it("does not DM again for the same job/cohort within the throttle window", async () => {
    const { bot, registrations, throttle } = makeDeps();
    await registrations.register(999, "maintainer");
    const deps = { bot, registrations, throttle, maintainerUsername: "maintainer" };

    await notifyJobFailure(deps, "daily-digest", "cohort-5", new Error("boom"));
    await notifyJobFailure(deps, "daily-digest", "cohort-5", new Error("boom again"));

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("throttles independently per job name and per cohort", async () => {
    const { bot, registrations, throttle } = makeDeps();
    await registrations.register(999, "maintainer");
    const deps = { bot, registrations, throttle, maintainerUsername: "maintainer" };

    await notifyJobFailure(deps, "daily-digest", "cohort-5", new Error("a"));
    await notifyJobFailure(deps, "weekly-digest", "cohort-5", new Error("b"));
    await notifyJobFailure(deps, "daily-digest", "cohort5-dryrun", new Error("c"));

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(3);
  });

  it("silently no-ops if the maintainer never ran /start (never throws)", async () => {
    const { bot, registrations, throttle } = makeDeps();
    await expect(
      notifyJobFailure(
        { bot, registrations, throttle, maintainerUsername: "maintainer" },
        "daily-digest",
        "cohort-5",
        new Error("boom"),
      ),
    ).resolves.toBeUndefined();
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("never throws even if sendMessage itself rejects", async () => {
    const { registrations, throttle } = makeDeps();
    await registrations.register(999, "maintainer");
    const bot = { api: { sendMessage: vi.fn().mockRejectedValue(new Error("blocked")) } };

    await expect(
      notifyJobFailure(
        { bot, registrations, throttle, maintainerUsername: "maintainer" },
        "daily-digest",
        "cohort-5",
        new Error("boom"),
      ),
    ).resolves.toBeUndefined();
  });

  it("exports the default throttle window as 24 hours", () => {
    expect(ERROR_THROTTLE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
