"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  CheckCircle2,
  Hash,
  Link2,
  Loader2,
  Megaphone,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAuditTime, statusGlyph } from "@/src/web/auditLogView";
import type { AuditLog } from "@/src/domain/types";

type ActionStatus = "idle" | "pending" | "ok" | "error";

interface WebhookStatus {
  url: string;
  pendingCount: number;
  lastError?: string;
  isMaintainer: boolean;
  registerTargetUrl?: string;
}

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Port of DevieBot's `app/dashboard/settings/page.tsx`. Issue #105
 * sub-stage 5c shipped the Telegram Group card and the inline Activity Log
 * (the two things with no dependency gaps); issue #130 (Parity S6) fills in
 * the three sections that were missing:
 *
 *  - **Appearance** — Light/Dark/System, over the same `next-themes`
 *    `useTheme()` hook the topbar toggle (`ThemeToggle`, sub-stage 5e)
 *    already uses. A second control over the same state, exactly as in
 *    Devie.
 *  - **Bot Connection** — webhook status, Register, Sync Bot Commands.
 *    Register repoints the *production* webhook, so it's gated to
 *    `MAINTAINER_USERNAME` server-side and hidden here for anyone else
 *    (`GET /api/settings/webhook`'s `isMaintainer` flag); it also confirms
 *    before firing, naming the exact destination, since Devie's own button
 *    fires immediately and a mis-click here silences the live bot for the
 *    whole cohort.
 *  - **Daily Standup (DSU)** — Preview (render-only) and Test (posts into
 *    the cohort's group) over the existing `src/jobs/standupPush.ts`, no
 *    new standup logic. Issue #131 adds the Auto-standup switch: the daily
 *    push is now scheduled by pg_cron at 00:05 UTC (8:05am Manila), gated
 *    on `cohorts.standup_enabled`, and this switch is that flag.
 *
 * Still dropped, per decision 2: the bot-token field and the whole
 * `telegram_config` concept — the token lives in `BOT_TOKEN`, never
 * rendered or returned by any route.
 *
 * No browser-side Supabase client (ADR-0002/ADR-0006) — every read/write is
 * a plain `fetch` against `/api/settings*`, same as `KanbanBoard`.
 */
export function SettingsPanel() {
  const [groupChatId, setGroupChatId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const { theme, setTheme } = useTheme();
  const [mountedTheme, setMountedTheme] = useState(false);
  useEffect(() => setMountedTheme(true), []);

  const [webhook, setWebhook] = useState<WebhookStatus | undefined>();
  const [webhookError, setWebhookError] = useState<string | undefined>();
  const [checkStatus, setCheckStatus] = useState<ActionStatus>("idle");
  const [syncStatus, setSyncStatus] = useState<ActionStatus>("idle");
  const [registerStatus, setRegisterStatus] = useState<ActionStatus>("idle");
  const [registerError, setRegisterError] = useState<string | undefined>();
  const [confirmRegisterOpen, setConfirmRegisterOpen] = useState(false);

  const [previewText, setPreviewText] = useState<string | undefined>();
  const [previewStatus, setPreviewStatus] = useState<ActionStatus>("idle");
  const [testStatus, setTestStatus] = useState<ActionStatus>("idle");
  const [testResult, setTestResult] = useState<string | undefined>();
  const [standupEnabled, setStandupEnabled] = useState(false);
  const [toggleStatus, setToggleStatus] = useState<ActionStatus>("idle");

  async function fetchSettings() {
    setLoading(true);
    setLoadingActivity(true);
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.ok) {
      setGroupChatId(data.groupChatId ?? "");
      setStandupEnabled(data.standupEnabled ?? false);
      setActivity(data.activity ?? []);
    }
    setLoading(false);
    setLoadingActivity(false);
  }

  async function fetchWebhookStatus() {
    setCheckStatus("pending");
    setWebhookError(undefined);
    const res = await fetch("/api/settings/webhook");
    const data = await res.json();
    if (data.ok) {
      setWebhook(data);
      setCheckStatus("ok");
    } else {
      setWebhookError(data.error ?? "Failed to check webhook status.");
      setCheckStatus("error");
    }
  }

  useEffect(() => {
    fetchSettings();
    fetchWebhookStatus();
  }, []);

  async function handleSyncCommands() {
    setSyncStatus("pending");
    const res = await fetch("/api/settings/commands", { method: "POST" });
    const data = await res.json();
    setSyncStatus(data.ok ? "ok" : "error");
  }

  async function handleRegister() {
    setConfirmRegisterOpen(false);
    setRegisterStatus("pending");
    setRegisterError(undefined);
    const res = await fetch("/api/settings/webhook", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      setRegisterStatus("ok");
      await fetchWebhookStatus();
    } else {
      setRegisterError(data.error ?? "Failed to register the webhook.");
      setRegisterStatus("error");
    }
  }

  async function handlePreviewStandup() {
    setPreviewStatus("pending");
    const res = await fetch("/api/settings/standup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "preview" }),
    });
    const data = await res.json();
    if (data.ok) {
      setPreviewText(data.text);
      setPreviewStatus("ok");
    } else {
      setPreviewStatus("error");
    }
  }

  async function handleTestStandup() {
    setTestStatus("pending");
    setTestResult(undefined);
    const res = await fetch("/api/settings/standup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "test" }),
    });
    const data = await res.json();
    if (data.ok) {
      setTestResult(data.sent ? `Sent to ${groupChatId}` : "Not sent — no group chat configured.");
      setTestStatus("ok");
    } else {
      setTestStatus("error");
    }
  }

  async function handleToggleStandup() {
    const next = !standupEnabled;
    setToggleStatus("pending");
    const res = await fetch("/api/settings/standup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next ? "enable" : "disable" }),
    });
    const data = await res.json();
    if (data.ok) {
      setStandupEnabled(next);
      setToggleStatus("ok");
      fetchSettings();
    } else {
      setToggleStatus("error");
    }
  }

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
      <div className="space-y-5">
        <div
          className="space-y-4 rounded-2xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}
            >
              <Sun className="h-4 w-4" style={{ color: "var(--primary)" }} />
            </div>
            <span className="font-semibold text-foreground">Appearance</span>
          </div>

          <div className="flex gap-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                type="button"
                variant={mountedTheme && theme === value ? "default" : "outline"}
                className="flex-1"
                onClick={() => setTheme(value)}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </div>

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

        <div
          className="space-y-4 rounded-2xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}
              >
                <Link2 className="h-4 w-4" style={{ color: "var(--primary)" }} />
              </div>
              <span className="font-semibold text-foreground">Bot Connection</span>
            </div>
            {webhook && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  color: webhook.url ? "#10b981" : "var(--muted-foreground)",
                  background: webhook.url
                    ? "color-mix(in srgb, #10b981 14%, transparent)"
                    : "var(--muted)",
                }}
              >
                {webhook.url ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {webhook.url ? "Active" : "Not registered"}
              </span>
            )}
          </div>

          {webhook?.url && (
            <p className="break-all text-xs text-muted-foreground">{webhook.url}</p>
          )}
          {webhook && (
            <p className="text-xs text-muted-foreground">
              Pending updates: {webhook.pendingCount}
              {webhook.lastError ? ` — last error: ${webhook.lastError}` : ""}
            </p>
          )}
          {webhookError && <p className="text-xs text-destructive">{webhookError}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={checkStatus === "pending"}
              onClick={fetchWebhookStatus}
            >
              {checkStatus === "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
              Check Status
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={syncStatus === "pending"}
              onClick={handleSyncCommands}
            >
              {syncStatus === "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
              Sync Bot Commands
            </Button>
            {webhook?.isMaintainer && (
              <Button
                type="button"
                variant="outline"
                disabled={registerStatus === "pending"}
                onClick={() => setConfirmRegisterOpen(true)}
              >
                {registerStatus === "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
                Register
              </Button>
            )}
          </div>

          {syncStatus === "ok" && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: "#10b981" }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Bot commands synced
            </p>
          )}
          {syncStatus === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Failed to sync bot commands
            </p>
          )}
          {registerStatus === "ok" && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: "#10b981" }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Webhook registered
            </p>
          )}
          {registerStatus === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" /> {registerError}
            </p>
          )}
        </div>

        <div
          className="space-y-4 rounded-2xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}
            >
              <Megaphone className="h-4 w-4" style={{ color: "var(--primary)" }} />
            </div>
            <span className="font-semibold text-foreground">Daily Standup (DSU)</span>
          </div>

          <div className="flex items-center justify-between gap-2.5 rounded-xl p-3" style={{ background: "var(--muted)" }}>
            <div>
              <p className="text-sm font-medium text-foreground">Auto-standup</p>
              <p className="text-xs text-muted-foreground">
                Posts to the group every day at 8:05am Manila
              </p>
            </div>
            <Button
              type="button"
              variant={standupEnabled ? "default" : "outline"}
              size="sm"
              disabled={toggleStatus === "pending"}
              onClick={handleToggleStandup}
              aria-pressed={standupEnabled}
            >
              {toggleStatus === "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
              {standupEnabled ? "On" : "Off"}
            </Button>
          </div>
          {toggleStatus === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Failed to update the switch
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={previewStatus === "pending"}
              onClick={handlePreviewStandup}
            >
              {previewStatus === "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
              Preview
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={testStatus === "pending"}
              onClick={handleTestStandup}
            >
              {testStatus === "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
              Test Standup
            </Button>
          </div>

          {previewStatus === "ok" && previewText !== undefined && (
            <pre
              className="max-h-64 overflow-auto rounded-lg p-3 text-[11px] whitespace-pre-wrap"
              style={{ background: "var(--muted)", fontFamily: "var(--font-mono)" }}
            >
              {previewText}
            </pre>
          )}
          {previewStatus === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Failed to build preview
            </p>
          )}
          {testStatus === "ok" && testResult && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: "#10b981" }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> {testResult}
            </p>
          )}
          {testStatus === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" /> Failed to send test standup
            </p>
          )}
        </div>
      </div>

      <Dialog open={confirmRegisterOpen} onOpenChange={setConfirmRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register production webhook?</DialogTitle>
            <DialogDescription>
              Point the live bot&apos;s webhook at {webhook?.registerTargetUrl ?? "the production deployment"}?
              This repoints the bot every cohort member talks to.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRegisterOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleRegister}>
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
