"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Hash, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAuditTime, statusGlyph } from "@/src/web/auditLogView";
import type { AuditLog } from "@/src/domain/types";

/**
 * Port of DevieBot's `app/dashboard/settings/page.tsx` (issue #105
 * sub-stage 5c) minus the bot-token field and the whole `telegram_config`
 * concept (ticket decision 2), and minus every other card on Devie's page
 * that has no analog in this repo — see the sub-stage 5c PR body for the
 * full list of what was dropped and why:
 *
 *  - The bot token field/"Telegram Bot" card: dropped per decision 2 (the
 *    token lives in `BOT_TOKEN`, never rendered).
 *  - `standup_enabled`, the "Bot Connection" webhook check/register/sync
 *    card, and the standup preview/send-now actions: all peers of
 *    `telegram_config` in Devie's schema, or backed by routes this repo
 *    doesn't have (webhook registration here is a deliberately
 *    script-only operation, `scripts/registerWebhook.ts` — see
 *    `src/ops/webhookRegistration.ts`'s doc comment on why that's not a
 *    dashboard button).
 *  - Theme switching ("Appearance" card): explicitly sub-stage 5e's job
 *    per the ticket ("Theme switching and the activity log view").
 *
 * What's left, and genuinely ported: the one field Devie's config row has
 * that isn't the bot token — the group chat id (`chat_id` on their side,
 * `cohorts.group_chat_id` on ours, already a plain non-secret column,
 * ADR-0006) — and the inline activity log Devie's own page reads back
 * after every save (`fetchAuditLogs`, `:126-134`). The *separate* dedicated
 * activity-log view is sub-stage 5e's job, not this one.
 *
 * No browser-side Supabase client (ADR-0002/ADR-0006) — every read/write is
 * a plain `fetch` against `/api/settings`, same as `KanbanBoard`.
 */
export function SettingsPanel() {
  const [groupChatId, setGroupChatId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  async function fetchSettings() {
    setLoading(true);
    setLoadingActivity(true);
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.ok) {
      setGroupChatId(data.groupChatId ?? "");
      setActivity(data.activity ?? []);
    }
    setLoading(false);
    setLoadingActivity(false);
  }

  useEffect(() => {
    fetchSettings();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveStatus("idle");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupChatId }),
    });
    const data = await res.json();
    setActivity(data.activity ?? []);
    setSaveStatus(data.ok ? "ok" : "error");
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--primary)" }} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 p-6 lg:grid-cols-2">
      <div
        className="space-y-4 rounded-2xl p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}
          >
            <Hash className="h-4 w-4" style={{ color: "var(--primary)" }} />
          </div>
          <span className="font-semibold text-foreground">Telegram Group</span>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Group Chat ID</Label>
          <Input
            value={groupChatId}
            onChange={(e) => setGroupChatId(e.target.value)}
            placeholder="-1001234567890"
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Settings
        </Button>

        {saveStatus === "ok" && (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: "#10b981" }}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Settings saved
          </p>
        )}
        {saveStatus === "error" && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5" /> Save failed
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)" }}>
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)" }}
        >
          <p
            className="text-[10px] font-semibold text-muted-foreground uppercase"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.15em" }}
          >
            Activity Log
          </p>
          <Button variant="ghost" size="icon-xs" onClick={fetchSettings} aria-label="Refresh activity log">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div
          className="max-h-96 min-h-14 space-y-1.5 overflow-y-auto p-3"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {loadingActivity ? (
            <p className="text-[11px] text-muted-foreground/60">Loading activity log...</p>
          ) : activity.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/50">No audit entries yet.</p>
          ) : (
            activity.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2">
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatAuditTime(entry.createdAt)}
                </span>
                <span
                  className="shrink-0 text-[10px]"
                  style={{
                    color:
                      entry.status === "ok"
                        ? "#10b981"
                        : entry.status === "error"
                          ? "var(--destructive)"
                          : "#60a5fa",
                  }}
                >
                  {statusGlyph(entry.status)}
                </span>
                <span className="text-xs text-foreground/70">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
