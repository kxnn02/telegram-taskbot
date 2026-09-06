"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAuditTime, statusGlyph } from "@/src/web/auditLogView";
import { groupAuditLogsByDay } from "@/src/web/activityLogView";
import type { AuditLog } from "@/src/domain/types";

/**
 * The dedicated activity-log page (issue #105 sub-stage 5e) — a standalone
 * view over the full, paginated `audit_logs` history, distinct from the
 * settings page's inline, capped-at-50 preview added in 5c
 * (`SettingsPanel`'s activity-log card, which stays as-is). Fetches from
 * `/api/activity`, "Load more" pages backward with the last-seen row's
 * `id` as the `?before=` cursor (see `AuditLogStorePort.listPage`'s doc
 * comment for why `id` rather than an offset).
 *
 * **This view has exactly one stated writer**: `SettingsService.saveGroupChatId`
 * (issue #105 sub-stage 5c) — the only place in this codebase that writes
 * to `audit_logs`, mirroring Devie's own single writer
 * (`app/dashboard/settings/page.tsx:137`). A fresh cohort with no settings
 * saves yet will see this page's empty state, not an error.
 *
 * No browser-side Supabase client (ADR-0002/ADR-0006) — every read is a
 * plain `fetch` against `/api/activity`, same as every other panel here.
 */
export function ActivityLogPanel() {
  const [entries, setEntries] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const fetchPage = useCallback(async (beforeId?: number) => {
    const url = beforeId ? `/api/activity?before=${beforeId}` : "/api/activity";
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? "Failed to load the activity log.");
      return;
    }
    setError(undefined);
    setEntries((prev) => (beforeId ? [...prev, ...(data.items ?? [])] : (data.items ?? [])));
    setHasMore(Boolean(data.hasMore));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPage().finally(() => setLoading(false));
  }, [fetchPage]);

  async function handleRefresh() {
    setLoading(true);
    await fetchPage();
    setLoading(false);
  }

  async function handleLoadMore() {
    const lastId = entries[entries.length - 1]?.id;
    if (lastId === undefined) return;
    setLoadingMore(true);
    await fetchPage(lastId);
    setLoadingMore(false);
  }

  const groups = groupAuditLogsByDay(entries);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Activity Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A full history of settings changes for this cohort.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleRefresh} aria-label="Refresh activity log">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--primary)" }} />
        </div>
      ) : groups.length === 0 ? (
        <div
          className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl text-center"
          style={{ border: "2px dashed var(--border)", background: "var(--muted)" }}
        >
          <ClipboardList className="h-10 w-10 opacity-20" style={{ color: "var(--primary)" }} />
          <div>
            <p className="text-sm font-medium text-muted-foreground">No activity yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Entries appear here whenever a cohort setting is saved.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.dateLabel}>
              <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                {group.dateLabel}
              </p>
              <div
                className="space-y-1.5 rounded-2xl p-4"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                {group.entries.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2.5">
                    <span
                      className="shrink-0 text-xs text-muted-foreground"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {formatAuditTime(entry.createdAt)}
                    </span>
                    <span
                      className="shrink-0 text-xs"
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
                    <span className="text-sm text-foreground/80">{entry.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
