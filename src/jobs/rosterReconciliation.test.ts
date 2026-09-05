import { describe, expect, it, vi } from "vitest";
import { InMemoryAlertThrottleStore } from "../storage/inMemoryAlertThrottleStore.js";
import { InMemoryRegistrationStore } from "../storage/inMemoryRegistrationStore.js";
import { InMemoryCohortStore } from "../storage/inMemoryCohortStore.js";
import { Roster } from "../domain/roster.js";
import { handleJobEndpoint } from "./jobEndpoint.js";
import { notifyJobFailure } from "./notifyJobFailure.js";
import {
  runRosterReconciliationJob,
  ROSTER_RECONCILIATION_THROTTLE_WINDOW_MS,
} from "./rosterReconciliation.js";
import type { RosterReconciliationDeps } from "./rosterReconciliation.js";

/** A minimal `MembershipApi` stub keyed by telegram user id, so each test
 * decides per-user what `getChatMember` should report without touching
 * `checkGroupMembership` itself (already covered by its own test file). */
function makeMembershipApi(byUserId: Record<number, { status: string; is_member?: boolean }>) {
  return {
    getChatMember: vi.fn(async (_chatId: number | string, userId: number) => {
      // Defaults to "member" (present) for any user id not explicitly
      // stubbed, so tests only need to spell out the interesting cases.
      const entry = byUserId[userId] ?? { status: "member" };
      return entry as never;
    }),
  };
}

function makeDeps(overrides: Partial<RosterReconciliationDeps> = {}) {
  const roster = new Roster([
    { username: "alice", cohortId: "cohort-5" },
    { username: "bob", cohortId: "cohort-5" },
    { username: "carol", cohortId: "cohort-5" },
  ]);
  const sendMessage = vi.fn();
  const deps: RosterReconciliationDeps = {
    bot: { api: { sendMessage } },
    api: makeMembershipApi({}),
    registrations: new InMemoryRegistrationStore(),
    roster,
    cohorts: new InMemoryCohortStore({ "cohort-5": "-100999" }),
    throttle: new InMemoryAlertThrottleStore(),
    ...overrides,
  };
  return { deps, sendMessage };
}

describe("runRosterReconciliationJob", () => {
  it("flags an absent member and DMs every other member of the cohort", async () => {
    const { deps, sendMessage } = makeDeps({
      api: makeMembershipApi({ 1: { status: "left" } }),
    });
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");
    await deps.registrations.register(3, "carol");

    await runRosterReconciliationJob(deps, "cohort-5");

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const chatIds = sendMessage.mock.calls.map((c) => c[0]).sort();
    expect(chatIds).toEqual([2, 3]);
    for (const call of sendMessage.mock.calls) {
      expect(call[1]).toContain("alice");
    }
  });

  it("does not flag a present member", async () => {
    const { deps, sendMessage } = makeDeps({
      api: makeMembershipApi({ 1: { status: "member" } }),
    });
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");
    await deps.registrations.register(3, "carol");

    await runRosterReconciliationJob(deps, "cohort-5");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("skips a roster member with no registration instead of flagging them", async () => {
    const { deps, sendMessage } = makeDeps({
      api: makeMembershipApi({}),
    });
    // alice never registered (never ran /start) — no telegram id to check.
    await deps.registrations.register(2, "bob");
    await deps.registrations.register(3, "carol");

    await expect(runRosterReconciliationJob(deps, "cohort-5")).resolves.toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("aborts the whole cohort without flagging anyone when membership is unavailable", async () => {
    const { deps, sendMessage } = makeDeps({
      // No group chat id configured for cohort-5 -> checkGroupMembership
      // reports "unavailable" for every member, never "absent".
      cohorts: new InMemoryCohortStore({}),
      api: makeMembershipApi({ 1: { status: "left" } }),
    });
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");
    await deps.registrations.register(3, "carol");

    await expect(runRosterReconciliationJob(deps, "cohort-5")).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("throttles a repeat flag within the window and allows one after it", async () => {
    let now = new Date("2026-09-01T00:00:00Z");
    const throttle = new InMemoryAlertThrottleStore(() => now);
    const { deps, sendMessage } = makeDeps({
      api: makeMembershipApi({ 1: { status: "left" } }),
      throttle,
    });
    await deps.registrations.register(1, "alice");
    await deps.registrations.register(2, "bob");
    await deps.registrations.register(3, "carol");

    await runRosterReconciliationJob(deps, "cohort-5", now);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    sendMessage.mockClear();
    now = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour later, still within window
    await runRosterReconciliationJob(deps, "cohort-5", now);
    expect(sendMessage).not.toHaveBeenCalled();

    sendMessage.mockClear();
    now = new Date(now.getTime() + ROSTER_RECONCILIATION_THROTTLE_WINDOW_MS + 1000);
    await runRosterReconciliationJob(deps, "cohort-5", now);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("scopes reconciliation per cohort: an absence in one cohort does not affect another", async () => {
    const roster = new Roster([
      { username: "alice", cohortId: "cohort-5" },
      { username: "bob", cohortId: "cohort-5" },
      { username: "dave", cohortId: "cohort-6" },
      { username: "erin", cohortId: "cohort-6" },
    ]);
    const sendMessage = vi.fn();
    const registrations = new InMemoryRegistrationStore();
    await registrations.register(1, "alice");
    await registrations.register(2, "bob");
    await registrations.register(3, "dave");
    await registrations.register(4, "erin");

    const deps: RosterReconciliationDeps = {
      bot: { api: { sendMessage } },
      api: makeMembershipApi({ 1: { status: "left" }, 3: { status: "member" } }),
      registrations,
      roster,
      cohorts: new InMemoryCohortStore({ "cohort-5": "-100999", "cohort-6": "-100888" }),
      throttle: new InMemoryAlertThrottleStore(),
    };

    await runRosterReconciliationJob(deps, "cohort-5");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe(2);

    sendMessage.mockClear();
    await runRosterReconciliationJob(deps, "cohort-6");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("routes a job failure through notifyJobFailure", async () => {
    const { deps } = makeDeps({
      cohorts: new InMemoryCohortStore({}), // unavailable -> throws
      api: makeMembershipApi({ 1: { status: "left" } }),
    });
    await deps.registrations.register(1, "alice");

    const maintainerSendMessage = vi.fn();
    const notifyDeps = {
      bot: { api: { sendMessage: maintainerSendMessage } },
      registrations: deps.registrations,
      throttle: deps.throttle,
      maintainerUsername: "maintainer",
    };
    await deps.registrations.register(999, "maintainer");

    const result = await handleJobEndpoint(
      {
        verify: () => true,
        work: () => runRosterReconciliationJob(deps, "cohort-5"),
        onError: (error) => notifyJobFailure(notifyDeps, "roster-reconciliation", "cohort-5", error),
      },
      { method: "POST", headers: {} },
    );

    expect(result.status).toBe(500);
    expect(maintainerSendMessage).toHaveBeenCalledTimes(1);
    expect(maintainerSendMessage.mock.calls[0]![0]).toBe(999);
  });
});
