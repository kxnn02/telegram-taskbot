import { describe, expect, it, vi } from "vitest";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { FixedClock } from "../domain/clock.js";
import { Roster } from "../domain/roster.js";
import { TaskService } from "../service/taskService.js";
import { FakeTextModel, ThrowingTextModel } from "../nlp/textModel.js";
import type { CohortStorePort } from "../storage/cohortStorePort.js";
import {
  buildStandupPushText,
  handleStandupPushEndpoint,
  sendStandupPush,
} from "./standupPush.js";
import { renderCertTipHtml, selectCertTipForDate } from "../bot/certTips.js";

// Issue #107, deviation #2: the push endpoint is authenticated via this
// repo's existing `src/jobs/jobAuth.ts` scheme — never a new one — because
// Devie's own `POST /api/standup` has no auth at all and is an open abuse
// vector (any stranger who finds the URL could broadcast into the live
// cohort group).

const COHORT = "cohort-5-dryrun";
const NOW = new Date("2026-09-01T04:00:00.000Z"); // ~noon Manila

function makeService() {
  const store = new InMemoryTaskStore();
  const roster = new Roster([
    { username: "carla", cohortId: COHORT },
    { username: "alice", cohortId: COHORT },
  ]);
  return new TaskService(store, roster, new FixedClock(NOW));
}

function fakeCohorts(groupChatId: string | undefined): CohortStorePort {
  return {
    getGroupChatId: vi.fn(async () => groupChatId),
    setGroupChatId: vi.fn(async () => {}),
    isStandupEnabled: vi.fn(async () => false),
    setStandupEnabled: vi.fn(async () => {}),
  };
}

describe("buildStandupPushText", () => {
  it("calls the model exactly once and renders the overview card", async () => {
    const model = new FakeTextModel(['"Ship it." — Someone, A Book']);
    const service = makeService();
    const text = await buildStandupPushText({ service, model }, COHORT, NOW);
    expect(model.requests).toHaveLength(1);
    expect(text).toContain('<i>"Ship it."</i>');
    expect(text).toContain("📋 <b>");
  });

  it("renders correctly with no model available (ThrowingTextModel) — no quote, but the card still ends with the day's cert tip", async () => {
    const model = new ThrowingTextModel();
    const service = makeService();
    const text = await buildStandupPushText({ service, model }, COHORT, NOW);
    const expectedTip = renderCertTipHtml(selectCertTipForDate(NOW));
    expect(text).not.toMatch(/<i>"/);
    expect(text).toContain("📋 <b>");
    expect(text.endsWith(expectedTip)).toBe(true);
  });
});

describe("sendStandupPush", () => {
  it("sends once to the cohort's configured group chat, as HTML", async () => {
    const model = new FakeTextModel(['"Ship it." — Someone, A Book']);
    const service = makeService();
    const sendMessage = vi.fn(
      async (_chatId: number | string, _text: string, _other?: { parse_mode?: "HTML" }) => ({}),
    );
    const bot = { api: { sendMessage } };
    const cohorts = fakeCohorts("-100123");

    const result = await sendStandupPush({ service, model, bot, cohorts }, COHORT, NOW);

    expect(result.sent).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe("-100123");
    expect(sendMessage.mock.calls[0]![2]).toEqual({ parse_mode: "HTML" });
  });

  it("chunks a card over Telegram's limit into multiple ordered sendMessage calls, none over 4000 chars, none HTML on a tag boundary (issue #179)", async () => {
    const model = new FakeTextModel(['"Ship it." — Someone, A Book']);
    const roster = new Roster([{ username: "carla", cohortId: COHORT }]);
    const store = new InMemoryTaskStore();
    const service = new TaskService(store, roster, new FixedClock(NOW));
    const caller = { username: "carla", cohortId: COHORT };
    for (let i = 0; i < 80; i++) {
      const created = await service.assignTask(caller, {
        assigneeUsername: "carla",
        title: `A fairly long task title for entry number ${i} so the card grows large`,
        dueDate: "2026-09-10",
      });
      if (!created.ok) throw new Error("setup failed");
    }
    const sendMessage = vi.fn(
      async (_chatId: number | string, _text: string, _other?: { parse_mode?: "HTML" }) => ({}),
    );
    const bot = { api: { sendMessage } };
    const cohorts = fakeCohorts("-100123");

    const result = await sendStandupPush({ service, model, bot, cohorts }, COHORT, NOW);

    expect(result.sent).toBe(true);
    expect(sendMessage.mock.calls.length).toBeGreaterThan(1);
    for (const call of sendMessage.mock.calls) {
      const text = call[1];
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(call[2]).toEqual({ parse_mode: "HTML" });
      // No chunk boundary falls inside an HTML tag: a tag never ends
      // without its closing `>` inside the same chunk.
      const openTagStarts = (text.match(/</g) ?? []).length;
      const openTagEnds = (text.match(/>/g) ?? []).length;
      expect(openTagStarts).toBe(openTagEnds);
    }
    // Sent in order: the header line lands in the first chunk, and the
    // quote (rendered last by `buildStandupOverviewCard`) lands in the
    // final chunk — never the reverse.
    const texts = sendMessage.mock.calls.map((c) => c[1]);
    expect(texts[0]).toContain("📋 <b>");
    expect(texts[texts.length - 1]).toContain('<i>"Ship it."</i>');
  });

  it("does not send, and reports sent:false, when the cohort has no group chat configured", async () => {
    const model = new FakeTextModel(['"Ship it." — Someone, A Book']);
    const service = makeService();
    const sendMessage = vi.fn(async () => ({}));
    const bot = { api: { sendMessage } };
    const cohorts = fakeCohorts(undefined);

    const result = await sendStandupPush({ service, model, bot, cohorts }, COHORT, NOW);

    expect(result.sent).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("handleStandupPushEndpoint", () => {
  function deps(overrides: { verify?: boolean; enabled?: boolean } = {}) {
    const sendMessage = vi.fn(async () => ({}));
    const buildPreview = vi.fn(async () => "the preview text");
    const send = vi.fn(async () => ({ sent: true }));
    const isEnabled = vi.fn(async () => overrides.enabled ?? true);
    return {
      deps: {
        verify: () => overrides.verify ?? true,
        buildPreview,
        send,
        isEnabled,
      },
      sendMessage,
      buildPreview,
      send,
      isEnabled,
    };
  }

  it("rejects an unauthenticated GET (preview) request", async () => {
    const { deps: d, buildPreview } = deps({ verify: false });
    const result = await handleStandupPushEndpoint(d, { method: "GET", headers: {} });
    expect(result.status).toBe(401);
    expect(buildPreview).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated POST (send) request", async () => {
    const { deps: d, send } = deps({ verify: false });
    const result = await handleStandupPushEndpoint(d, { method: "POST", headers: {} });
    expect(result.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("an authenticated POST sends once when the standup is enabled", async () => {
    const { deps: d, send } = deps({ verify: true, enabled: true });
    const result = await handleStandupPushEndpoint(d, { method: "POST", headers: {} });
    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an authenticated GET renders a preview without sending", async () => {
    const { deps: d, buildPreview, send } = deps({ verify: true });
    const result = await handleStandupPushEndpoint(d, { method: "GET", headers: {} });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ preview: "the preview text" });
    expect(buildPreview).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("a GET preview is unaffected by the standup flag being off", async () => {
    const { deps: d, buildPreview, isEnabled } = deps({ verify: true, enabled: false });
    const result = await handleStandupPushEndpoint(d, { method: "GET", headers: {} });
    expect(result.status).toBe(200);
    expect(buildPreview).toHaveBeenCalledTimes(1);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("a POST skips sending and returns sent:false with 200 when the standup is disabled", async () => {
    const { deps: d, send, isEnabled } = deps({ verify: true, enabled: false });
    const result = await handleStandupPushEndpoint(d, { method: "POST", headers: {} });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ sent: false });
    expect(isEnabled).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("405s any other method", async () => {
    const { deps: d } = deps({ verify: true });
    const result = await handleStandupPushEndpoint(d, { method: "DELETE", headers: {} });
    expect(result.status).toBe(405);
  });
});
