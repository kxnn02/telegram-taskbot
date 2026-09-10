import { describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import type { Caller } from "../domain/types.js";
import { TaskService } from "../service/taskService.js";
import { buildStandup, formatReportDate } from "./standup.js";
import { buildStandupOverviewCard } from "./standupOverviewCard.js";
import { standupSummaryLine } from "./standupBuckets.js";

// Issue #107: the push endpoint's HTML overview card — greeting, header,
// counts, per-status detail, week framing, and (only here) the AI daily
// quote. Issue #180: the books-reminder line is gone; the card now always
// ends with a rotating certification tip instead, quote or no quote.

const COHORT = "cohort-5-dryrun";
const NOW = new Date("2026-09-01T04:00:00.000Z"); // Tuesday, ~noon Manila
const carla: Caller = { username: "carla", cohortId: COHORT };
const CERT_TIP_HTML = "💡 <b>Test tip lead.</b> Test tip body.\n— <i>Someone</i>";

function makeService() {
  const store = new InMemoryTaskStore();
  const roster = new Roster([
    { username: "carla", cohortId: COHORT },
    { username: "alice", cohortId: COHORT },
  ]);
  return new TaskService(store, roster, new FixedClock(NOW));
}

function makeServiceWith(usernames: string[]) {
  const store = new InMemoryTaskStore();
  const roster = new Roster(usernames.map((username) => ({ username, cohortId: COHORT })));
  return new TaskService(store, roster, new FixedClock(NOW));
}

describe("buildStandupOverviewCard — person-first layout (#165 S2)", () => {
  it("the summary line replaces the count block, and none of the old count-block strings survive", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    expect(card).toContain(standupSummaryLine(report.tasks));
    for (const stale of [
      "📊 <b>Overview</b>",
      "🔄 In progress:",
      "👀 In review:",
      "📝 To do:",
      "📦 Backlog:",
      "✅ Done:",
      "🚧 Blocked:",
      "⚠️ Overdue:",
      "📚 <b>Reminder:</b>",
      "Read and finish your assigned books, cohorts! Consistency compounds.",
    ]) {
      expect(card).not.toContain(stale);
    }
  });

  it("the summary sits immediately under the date line, with no blank line between", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });
    const lines = card.split("\n");

    const dateIdx = lines.indexOf(`<i>${formatReportDate(report.today)}</i>`);
    expect(dateIdx).toBeGreaterThan(-1);
    expect(lines[dateIdx + 1]).toBe(standupSummaryLine(report.tasks));
  });

  it("is person-first: each member heading appears exactly once, alphabetically", async () => {
    const service = makeServiceWith(["carla", "alice", "bob"]);
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Alice task",
      dueDate: "2026-09-05",
    });
    await service.assignTask(carla, {
      assigneeUsername: "carla",
      title: "Carla task",
      dueDate: "2026-09-05",
    });
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    const aliceIdx = card.indexOf("👤 <b>@alice</b>");
    const carlaIdx = card.indexOf("👤 <b>@carla</b>");
    expect(aliceIdx).toBeGreaterThan(-1);
    expect(carlaIdx).toBeGreaterThan(-1);
    expect(aliceIdx).toBeLessThan(carlaIdx);
    expect(card.split("👤 <b>@alice</b>")).toHaveLength(2);
    expect(card.split("👤 <b>@carla</b>")).toHaveLength(2);
  });

  it("renders the three bucket headings with counts, in order, within a member's block", async () => {
    const service = makeService();
    const alice = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Overdue task",
      dueDate: "2026-08-20",
    });
    if (!alice.ok) throw new Error("setup failed");
    await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Doing task one",
      dueDate: "2026-09-10",
    });
    const doingTwo = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Doing task two",
      dueDate: "2026-09-11",
    });
    if (!doingTwo.ok) throw new Error("setup failed");
    await service.setStatus(carla, doingTwo.value.id, "in_progress");
    const review = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Review task",
      dueDate: "2026-09-12",
    });
    if (!review.ok) throw new Error("setup failed");
    await service.setStatus(carla, review.value.id, "in_review");

    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    const overdueIdx = card.indexOf("⚠️ <b>Overdue (1)</b>");
    const doingIdx = card.indexOf("🔄 <b>Doing (2)</b>");
    const approvalIdx = card.indexOf("👀 <b>For approval (1)</b>");
    expect(overdueIdx).toBeGreaterThan(-1);
    expect(doingIdx).toBeGreaterThan(overdueIdx);
    expect(approvalIdx).toBeGreaterThan(doingIdx);
  });

  it("an overdue in_review task appears once, under Overdue only", async () => {
    const service = makeService();
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Overdue review task",
      dueDate: "2026-08-20",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setStatus(carla, created.value.id, "in_review");

    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    expect(card.split("Overdue review task")).toHaveLength(2);
    expect(card).toContain("⚠️ <b>Overdue (1)</b>");
    expect(card).not.toContain("👀 <b>For approval");
  });

  it("a member holding only backlog and done tasks is absent, but is still counted in the summary", async () => {
    const service = makeService();
    const backlogTask = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Backlog task",
      dueDate: "2026-09-20",
    });
    if (!backlogTask.ok) throw new Error("setup failed");
    await service.setStatus(carla, backlogTask.value.id, "backlog");
    const doneTask = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Done task",
      dueDate: "2026-09-20",
    });
    if (!doneTask.ok) throw new Error("setup failed");
    await service.setStatus(carla, doneTask.value.id, "done");

    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    expect(card).not.toContain("👤 <b>@alice</b>");
    expect(card).toContain("📦 1 backlog");
  });

  it("empty cohort renders the no-open-tasks line and keeps everything else", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const quote = '<i>"Ship it."</i>\n— <i>Someone, A Book</i>';
    const card = buildStandupOverviewCard(report, { now: NOW, quote, certTip: CERT_TIP_HTML });

    expect(card).toContain("<i>No open tasks right now.</i>");
    expect(card.startsWith("Good afternoon, team!")).toBe(true);
    expect(card).toContain("✅ <b>Done this week");
    expect(card).toContain("🗓️ <b>Done last week");
    expect(card).toContain("<i>No tasks completed this week yet.</i>");
    expect(card).toContain("<i>Nothing completed last week.</i>");
    expect(card.endsWith(CERT_TIP_HTML)).toBe(true);
  });

  it("a blocked task's reason survives inside the Doing bucket (#146)", async () => {
    const service = makeService();
    const created = await service.assignTask(carla, {
      assigneeUsername: "alice",
      title: "Deploy staging",
      dueDate: "2026-09-15",
    });
    if (!created.ok) throw new Error("setup failed");
    await service.setBlocked(carla, created.value.id, "waiting on infra access");

    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    expect(card).toContain("🔄 <b>Doing (1)</b>");
    expect(card).toContain("— <i>waiting on infra access</i>");
  });
});

describe("buildStandupOverviewCard", () => {
  it("puts the quote immediately above the tip, and the card always ends with the tip", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const quote = '<i>"Ship it."</i>\n— <i>Someone, A Book</i>';

    const card = buildStandupOverviewCard(report, { now: NOW, quote, certTip: CERT_TIP_HTML });

    const quoteIdx = card.indexOf(quote);
    const tipIdx = card.indexOf(CERT_TIP_HTML);
    expect(quoteIdx).toBeGreaterThan(-1);
    expect(tipIdx).toBeGreaterThan(quoteIdx);
    expect(card.endsWith(CERT_TIP_HTML)).toBe(true);
  });

  it("a failed (empty) quote leaves the rest of the card intact, still ending with the tip, with no stray blank lines", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });

    expect(card).not.toMatch(/\n\n\n/);
    expect(card.endsWith(CERT_TIP_HTML)).toBe(true);
  });

  it("does not hardcode a cohort name — uses the caller's own cohort", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });
    expect(card).toContain("Cohort 5 Dryrun");
    expect(card).not.toContain("COHORT 4");
  });

  it("includes the greeting for the given time", async () => {
    const service = makeService();
    const report = await buildStandup(service, carla, NOW);
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });
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
    const card = buildStandupOverviewCard(report, { now: NOW, quote: "", certTip: CERT_TIP_HTML });
    expect(card).not.toContain("Secret task");
    expect(card).not.toContain("cohort-9");
  });
});
