"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, MessageCircle, Trash2, UserPlus, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { memberColor, memberInitials, memberLabel } from "@/src/web/memberUtils";
import { buildTeamStats, sortMembersByUsername } from "@/src/web/teamView";

interface TeamMember {
  username: string;
  telegramId?: number;
  registeredAt?: string;
}

/**
 * Port of DevieBot's `app/dashboard/team/page.tsx` (issue #105 sub-stage
 * 5d) — the header, "Add Member" dialog, stats row, and member list are
 * all carried across; only the parts tied to a concept this repo's roster
 * doesn't have are dropped:
 *
 *  - **No role column, no role grouping, no role datalist/input.** Devie
 *    groups the list by `role` and lets you inline-edit it; #106 deleted
 *    roles from this codebase entirely (ADR-0013), so the list here is one
 *    flat table sorted by username (`sortMembersByUsername`), and the "Add
 *    Member" dialog has no role field.
 *  - **No `name` field.** Devie's `members` row has a `name` column; this
 *    repo's roster row is just `(username, cohort_id)` (ADR-0003) — the
 *    "Add Member" dialog collects only a Telegram username, matching what
 *    actually gets written. `memberLabel`/`memberInitials`/`memberColor`
 *    (ported in sub-stage 5b as `memberUtils.ts`) already fall back to
 *    username when there's no name, so the row rendering needs no change
 *    for this.
 *  - **Telegram ID and "Joined" are read-only.** They come from the
 *    `registrations` table (populated only by `/start`), not from anything
 *    typed into this form — there is no admin-supplied Telegram id the way
 *    Devie's form has one, because nothing on this page can make a
 *    Telegram id real.
 *  - **"Edit" renames the username** (a PATCH to `/api/team/[username]`)
 *    rather than editing a role — the only field left once role is gone.
 *    Devie's role edit was an inline `<input>` with blur-to-save; the same
 *    interaction shape is kept here, just renaming instead.
 *
 * No browser-side Supabase client (ADR-0002/ADR-0006) — every read/write is
 * a plain `fetch` against `/api/team`, same as `SettingsPanel`/`KanbanBoard`.
 */
export function TeamPanel() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const [renamingUsername, setRenamingUsername] = useState<string | undefined>(undefined);
  const [deletingUsername, setDeletingUsername] = useState<string | undefined>(undefined);

  async function fetchMembers() {
    setLoading(true);
    setError(undefined);
    const res = await fetch("/api/team");
    const data = await res.json();
    if (data.ok) {
      setMembers(data.members ?? []);
    } else {
      setError(data.error ?? "Failed to load team.");
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchMembers();
  }, []);

  const sorted = useMemo(() => sortMembersByUsername(members), [members]);
  const stats = useMemo(() => buildTeamStats(members, new Date()), [members]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim()) return;
    setSubmitting(true);
    setAddError(undefined);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername.trim() }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!data.ok) {
      setAddError(data.error ?? "Failed to add member.");
      return;
    }
    setDialogOpen(false);
    setNewUsername("");
    await fetchMembers();
  }

  async function handleRename(oldUsername: string, newValue: string) {
    const trimmed = newValue.trim();
    if (!trimmed || trimmed.toLowerCase() === oldUsername.toLowerCase()) return;
    setRenamingUsername(oldUsername);
    await fetch(`/api/team/${encodeURIComponent(oldUsername)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: trimmed }),
    });
    setRenamingUsername(undefined);
    await fetchMembers();
  }

  async function handleDelete(username: string) {
    setDeletingUsername(username);
    await fetch(`/api/team/${encodeURIComponent(username)}`, { method: "DELETE" });
    setDeletingUsername(undefined);
    await fetchMembers();
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mono-tag mb-2">
            <span className="lime-dot" />
            <span>Members</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Members auto-register when they message in Telegram, or add them manually here.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="mt-1 shrink-0">
          <UserPlus className="h-4 w-4" />
          Add Member
        </Button>
      </div>

      {/* Add Member dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Adds a username to the roster. They can message the bot with this username at any
              time to finish registering.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdd} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="m-username">
                Telegram Username <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground select-none">
                  @
                </span>
                <Input
                  id="m-username"
                  placeholder="username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.replace(/^@/, ""))}
                  className="pl-7"
                  required
                />
              </div>
            </div>

            {addError && <p className="text-xs text-destructive">{addError}</p>}

            <DialogFooter showCloseButton>
              <Button type="submit" disabled={submitting || !newUsername.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Add Member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stats row */}
      {!loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { icon: Users, label: "Total Members", value: stats.total, color: "var(--primary)" },
            { icon: UserPlus, label: "New this week", value: stats.newThisWeek, color: "var(--devcon-sky)" },
            { icon: CalendarDays, label: "New this month", value: stats.newThisMonth, color: "#10b981" },
          ].map((stat) => (
            <div key={stat.label} className="glass-panel flex items-center gap-4 rounded-2xl p-5">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: `color-mix(in srgb, ${stat.color} 14%, transparent)` }}
              >
                <stat.icon className="h-5 w-5" style={{ color: stat.color }} />
              </div>
              <div>
                <div
                  className="text-3xl leading-none font-bold tabular-nums"
                  style={{ color: stat.color, fontFamily: "var(--font-jetbrains-mono)" }}
                >
                  {stat.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Member list */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--primary)" }} />
        </div>
      ) : sorted.length === 0 ? (
        <div
          className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl text-center"
          style={{ border: "2px dashed var(--border)", background: "var(--muted)" }}
        >
          <MessageCircle className="h-10 w-10 opacity-20" style={{ color: "var(--primary)" }} />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No members yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Add members manually or wait for them to message in your Telegram group.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="overflow-hidden overflow-x-auto rounded-2xl"
          style={{ border: "1px solid var(--border)", background: "var(--card)" }}
        >
          <div
            className="grid gap-4 px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest"
            style={{
              gridTemplateColumns: "2fr 1.2fr 1.2fr auto",
              borderBottom: "1px solid var(--border)",
              background: "var(--muted)",
              fontFamily: "var(--font-jetbrains-mono)",
            }}
          >
            <span>Member</span>
            <span>Telegram ID</span>
            <span>Joined</span>
            <span />
          </div>

          {sorted.map((member, i) => {
            const memberForUtils = { id: member.username, ...member };
            const color = memberColor(memberForUtils);
            const name = memberLabel(memberForUtils);
            const isLast = i === sorted.length - 1;
            return (
              <div
                key={member.username}
                className="group grid items-center gap-4 px-5 py-3 transition-colors"
                style={{
                  gridTemplateColumns: "2fr 1.2fr 1.2fr auto",
                  borderBottom: isLast ? "none" : "1px solid var(--border)",
                }}
              >
                {/* Avatar + editable username */}
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold select-none"
                    style={{
                      background: `color-mix(in srgb, ${color} 15%, transparent)`,
                      border: `1.5px solid color-mix(in srgb, ${color} 35%, transparent)`,
                      color,
                    }}
                  >
                    {memberInitials(memberForUtils)}
                  </div>
                  {renamingUsername === member.username ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <input
                      defaultValue={member.username}
                      onBlur={(e) => handleRename(member.username, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      aria-label={`Rename ${name}`}
                      className="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-foreground transition-all focus:border-input focus:bg-background focus:outline-none"
                    />
                  )}
                </div>

                {/* Telegram ID */}
                <span
                  className="truncate text-sm text-muted-foreground"
                  style={{ fontFamily: "var(--font-jetbrains-mono)" }}
                >
                  {member.telegramId ?? "—"}
                </span>

                {/* Joined */}
                <span
                  className="truncate text-sm whitespace-nowrap text-muted-foreground"
                  style={{ fontFamily: "var(--font-jetbrains-mono)" }}
                >
                  {member.registeredAt ? new Date(member.registeredAt).toLocaleDateString() : "—"}
                </span>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(member.username)}
                  disabled={deletingUsername === member.username}
                  aria-label={`Remove ${name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                >
                  {deletingUsername === member.username ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
