import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import { buildStandup } from "./standup.js";
import { buildStandupOverviewCard } from "./standupOverviewCard.js";

// Issue #107: the push endpoint's HTML overview card — greeting, header,
// counts, per-status detail, week framing, the books-reminder line, and
// (only here) the AI daily quote appended at the very end.

const COHORT = "cohort-5-dryrun";
const NOW = new Date("2026-09-01T04:00:00.000Z"); // Tuesday, ~noon Manila
const carla: Caller = { username: "carla", cohortId: COHORT };

function makeService() {
  const store = new InMemoryTaskStore();
  const roster = new Roster([
    { username: "carla", cohortId: COHORT },
    { username: "alice", cohortId: COHORT },
  ]);
  return new TaskService(store, roster, new FixedClock(NOW));
}

describe("buildStandupOverviewCard", () => {
  it("puts the quote after the reminder line, at the very end", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const quote = '<i>"Ship it."</i>\n— <i>Someone, A Book</i>';

    const card = buildStandupOverviewCard(report, { now: NOW, quote });

    const reminderIdx = card.indexOf("📚 <b>Reminder:</b>");
    const quoteIdx = card.indexOf(quote);
    expect(reminderIdx).toBeGreaterThan(-1);
    expect(quoteIdx).toBeGreaterThan(reminderIdx);
    expect(card.endsWith(quote)).toBe(true);
  });

  it("copies the books-reminder line verbatim", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "" });
    expect(card).toContain(
      "📚 <b>Reminder:</b> <i>Read and finish your assigned books, cohorts! Consistency compounds.</i>",
    );
  });

  it("a failed (empty) quote leaves the rest of the card intact with no stray blank lines", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "" });

    expect(card).not.toMatch(/\n\n\n/);
    expect(card.endsWith("Consistency compounds.</i>")).toBe(true);
  });

  it("does not hardcode a cohort name — uses the caller's own cohort", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "" });
    expect(card).toContain("Cohort 5 Dryrun");
    expect(card).not.toContain("COHORT 4");
  });

  it("includes the greeting for the given time", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "" });
    expect(card.startsWith("Good afternoon, team!")).toBe(true);
  });

  it("cohort isolation: only the caller's own cohort's tasks/name appear", async () => {
    const store = new InMemoryTaskStore();
    const roster = new Roster([
      { username: "carla", cohortId: COHORT },
      { username: "other", cohortId: "cohort-9" },
    ]);
    const service = new TaskService(store, roster, new FixedClock(NOW));
    await service.assignTask(
      { username: "other", cohortId: "cohort-9" },
      { assigneeUsername: "other", title: "Secret task", dueDate: "2026-09-05" },
    );
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Visible task",
      dueDate: "2026-09-05",
    });

    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "" });
    expect(card).not.toContain("Secret task");
    expect(card).not.toContain("cohort-9");
  });
});
