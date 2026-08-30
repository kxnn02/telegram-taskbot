import { describe, expect, it, vi } from "vitest";
import { WIZARD_EXPIRY_MS, WizardManager } from "./wizard.js";

describe("WizardManager.start", () => {
  it("starts an edit wizard at awaiting_field_choice", () => {
    const wizards = new WizardManager();
    const state = wizards.start(1, "edit", { taskId: 5 });
    expect(state.step).toBe("awaiting_field_choice");
    expect(state.kind).toBe("edit");
    expect(state.data.taskId).toBe(5);
  });

  it("still starts an assign wizard at awaiting_assignee (regression)", () => {
    const wizards = new WizardManager();
    const state = wizards.start(1, "assign");
    expect(state.step).toBe("awaiting_assignee");
    expect(state.kind).toBe("assign");
  });
});

describe("WizardManager get/update/cancel/has", () => {
  it("get returns undefined when no wizard is in progress", () => {
    const wizards = new WizardManager();
    expect(wizards.get(1)).toBeUndefined();
    expect(wizards.has(1)).toBe(false);
  });

  it("update merges data and advances the step, for both kinds", () => {
    const wizards = new WizardManager();
    wizards.start(1, "edit", { taskId: 5 });
    const updated = wizards.update(1, {
      step: "awaiting_title",
      data: { editField: "title" },
    });
    expect(updated?.step).toBe("awaiting_title");
    expect(updated?.data.editField).toBe("title");
    expect(updated?.data.taskId).toBe(5); // earlier data preserved

    wizards.start(2, "assign");
    const updatedAssign = wizards.update(2, {
      step: "awaiting_title",
      data: { assigneeUsername: "alice" },
    });
    expect(updatedAssign?.step).toBe("awaiting_title");
    expect(updatedAssign?.data.assigneeUsername).toBe("alice");
  });

  it("update returns undefined for a user with no wizard", () => {
    const wizards = new WizardManager();
    expect(wizards.update(1, { step: "awaiting_title" })).toBeUndefined();
  });

  it("cancel removes the wizard and reports whether one existed", () => {
    const wizards = new WizardManager();
    wizards.start(1, "edit", { taskId: 5 });
    expect(wizards.cancel(1)).toBe(true);
    expect(wizards.has(1)).toBe(false);
    expect(wizards.cancel(1)).toBe(false);
  });

  it("has reflects presence for both kinds", () => {
    const wizards = new WizardManager();
    wizards.start(1, "edit", { taskId: 5 });
    wizards.start(2, "assign");
    expect(wizards.has(1)).toBe(true);
    expect(wizards.has(2)).toBe(true);
  });
});

describe("WizardManager expiry", () => {
  it("get returns undefined and clears state once the wizard has expired", () => {
    vi.useFakeTimers();
    try {
      const wizards = new WizardManager();
      wizards.start(1, "edit", { taskId: 5 });
      vi.advanceTimersByTime(WIZARD_EXPIRY_MS + 1);
      expect(wizards.get(1)).toBeUndefined();
      expect(wizards.has(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("update refreshes lastActivity, delaying expiry", () => {
    vi.useFakeTimers();
    try {
      const wizards = new WizardManager();
      wizards.start(1, "assign");
      vi.advanceTimersByTime(WIZARD_EXPIRY_MS - 1000);
      wizards.update(1, { step: "awaiting_title" });
      vi.advanceTimersByTime(2000);
      // Would have expired without the update refreshing lastActivity.
      expect(wizards.get(1)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
