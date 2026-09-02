import { describe, expect, it, vi } from "vitest";
import { WIZARD_EXPIRY_MS, WizardManager } from "./wizard.js";
import { InMemoryWizardStateStore } from "../storage/inMemoryWizardStateStore.js";

function makeManager() {
  return new WizardManager(new InMemoryWizardStateStore());
}

describe("WizardManager.start", () => {
  it("starts an edit wizard at awaiting_field_choice", async () => {
    const wizards = makeManager();
    const state = await wizards.start(1, "edit", { taskId: 5 });
    expect(state.step).toBe("awaiting_field_choice");
    expect(state.kind).toBe("edit");
    expect(state.data.taskId).toBe(5);
  });

  it("still starts an assign wizard at awaiting_assignee (regression)", async () => {
    const wizards = makeManager();
    const state = await wizards.start(1, "assign");
    expect(state.step).toBe("awaiting_assignee");
    expect(state.kind).toBe("assign");
  });
});

describe("WizardManager get/update/cancel/has", () => {
  it("get returns undefined when no wizard is in progress", async () => {
    const wizards = makeManager();
    expect(await wizards.get(1)).toBeUndefined();
    expect(await wizards.has(1)).toBe(false);
  });

  it("update merges data and advances the step, for both kinds", async () => {
    const wizards = makeManager();
    await wizards.start(1, "edit", { taskId: 5 });
    const updated = await wizards.update(1, {
      step: "awaiting_title",
      data: { editField: "title" },
    });
    expect(updated?.step).toBe("awaiting_title");
    expect(updated?.data.editField).toBe("title");
    expect(updated?.data.taskId).toBe(5); // earlier data preserved

    await wizards.start(2, "assign");
    const updatedAssign = await wizards.update(2, {
      step: "awaiting_title",
      data: { assigneeUsername: "alice" },
    });
    expect(updatedAssign?.step).toBe("awaiting_title");
    expect(updatedAssign?.data.assigneeUsername).toBe("alice");
  });

  it("update returns undefined for a user with no wizard", async () => {
    const wizards = makeManager();
    expect(await wizards.update(1, { step: "awaiting_title" })).toBeUndefined();
  });

  it("cancel removes the wizard and reports whether one existed", async () => {
    const wizards = makeManager();
    await wizards.start(1, "edit", { taskId: 5 });
    expect(await wizards.cancel(1)).toBe(true);
    expect(await wizards.has(1)).toBe(false);
    expect(await wizards.cancel(1)).toBe(false);
  });

  it("has reflects presence for both kinds", async () => {
    const wizards = makeManager();
    await wizards.start(1, "edit", { taskId: 5 });
    await wizards.start(2, "assign");
    expect(await wizards.has(1)).toBe(true);
    expect(await wizards.has(2)).toBe(true);
  });
});

describe("WizardManager expiry", () => {
  it("get returns undefined and clears state once the wizard has expired", async () => {
    vi.useFakeTimers();
    try {
      const wizards = makeManager();
      await wizards.start(1, "edit", { taskId: 5 });
      vi.advanceTimersByTime(WIZARD_EXPIRY_MS + 1);
      expect(await wizards.get(1)).toBeUndefined();
      expect(await wizards.has(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("update refreshes lastActivity, delaying expiry", async () => {
    vi.useFakeTimers();
    try {
      const wizards = makeManager();
      await wizards.start(1, "assign");
      vi.advanceTimersByTime(WIZARD_EXPIRY_MS - 1000);
      await wizards.update(1, { step: "awaiting_title" });
      vi.advanceTimersByTime(2000);
      // Would have expired without the update refreshing lastActivity.
      expect(await wizards.get(1)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WizardManager.takeExpired (issue #63, finding H7)", () => {
  it("returns false when the user never had a wizard", async () => {
    const wizards = makeManager();
    expect(await wizards.takeExpired(1)).toBe(false);
  });

  it("returns false while a wizard is live (not expired)", async () => {
    const wizards = makeManager();
    await wizards.start(1, "assign");
    expect(await wizards.takeExpired(1)).toBe(false);
  });

  it("returns true exactly once when a wizard has expired, and deletes it", async () => {
    vi.useFakeTimers();
    try {
      const wizards = makeManager();
      await wizards.start(1, "assign");
      vi.advanceTimersByTime(WIZARD_EXPIRY_MS + 1);
      expect(await wizards.takeExpired(1)).toBe(true);
      expect(await wizards.takeExpired(1)).toBe(false);
      expect(await wizards.has(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("get still returns undefined for an expired wizard (unchanged behaviour)", async () => {
    vi.useFakeTimers();
    try {
      const wizards = makeManager();
      await wizards.start(1, "assign");
      vi.advanceTimersByTime(WIZARD_EXPIRY_MS + 1);
      expect(await wizards.get(1)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
