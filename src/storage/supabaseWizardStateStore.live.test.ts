import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { SupabaseWizardStateStore } from "./supabaseWizardStateStore.js";
import type { WizardState } from "../bot/wizard.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "supabaseWizardStateStore.live.test.ts requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const client: SupabaseClient = createClient(url, serviceRoleKey);

describe("SupabaseWizardStateStore (live)", () => {
  let telegramUserId: number;

  afterEach(async () => {
    await client.from("wizard_state").delete().eq("telegram_user_id", telegramUserId);
  });

  it("round-trips a wizard state through set/get, preserving shape", async () => {
    telegramUserId = randomInt(1_000_000_000, 2_000_000_000);
    const store = new SupabaseWizardStateStore(client);
    const state: WizardState = {
      kind: "assign",
      step: "awaiting_title",
      data: { assigneeUsername: "alice" },
      lastActivity: Date.now(),
    };

    await store.set(telegramUserId, state);
    const fetched = await store.get(telegramUserId);

    expect(fetched?.kind).toBe("assign");
    expect(fetched?.step).toBe("awaiting_title");
    expect(fetched?.data).toEqual({ assigneeUsername: "alice" });
    // Round-trips through a timestamptz column, so compare at second
    // granularity rather than exact millisecond equality.
    expect(Math.abs((fetched?.lastActivity ?? 0) - state.lastActivity)).toBeLessThan(1000);
  });

  it("upserts on a repeat set for the same user, and delete reports whether a row existed", async () => {
    telegramUserId = randomInt(1_000_000_000, 2_000_000_000);
    const store = new SupabaseWizardStateStore(client);

    await store.set(telegramUserId, {
      kind: "edit",
      step: "awaiting_field_choice",
      data: { taskId: 1 },
      lastActivity: Date.now(),
    });
    await store.set(telegramUserId, {
      kind: "edit",
      step: "awaiting_title",
      data: { taskId: 1, editField: "title" },
      lastActivity: Date.now(),
    });

    const fetched = await store.get(telegramUserId);
    expect(fetched?.step).toBe("awaiting_title");

    expect(await store.delete(telegramUserId)).toBe(true);
    expect(await store.get(telegramUserId)).toBeUndefined();
    expect(await store.delete(telegramUserId)).toBe(false);
  });
});
