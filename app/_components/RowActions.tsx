"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskWithFlags } from "../../src/service/taskService";
import { Icon } from "./icons";

/**
 * Per-row edit/approve/revise actions for the oversight table (Phase 6.2,
 * issue #17 — explicitly deferred by Phase 6.1's `app/page.tsx` comment).
 * Edit is a plain link to the edit page (same as the Express dashboard's
 * `editActionCell`); Approve/Revise are new to the dashboard (the Express
 * version never had them — only bot inline buttons did) and are added here
 * as small `fetch` calls against the new REST mutation routes, per
 * ADR-0008. No new data is threaded in beyond what `TaskWithFlags` already
 * carries (id, status) — `oversightData.ts`'s contract is untouched.
 */
export function RowActions({ task }: { task: Pick<TaskWithFlags, "id" | "status"> }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "revise" | undefined>();
  const [error, setError] = useState<string | undefined>();

  // The Approved edit-lock is gone (issue #27/#28) — every task is editable.
  const canEdit = true;
  const canReview = task.status === "in_review";

  async function act(action: "approve" | "revise") {
    setPending(action);
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${task.id}/${action}`, { method: "POST" });
      const data = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!data.ok) {
        setError(data.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(undefined);
    }
  }

  if (!canEdit && !canReview) return null;

  return (
    <div className="row-actions" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {canEdit ? (
          <a className="btn secondary sm" href={`/tasks/${task.id}/edit`}>
            <Icon name="pen" size={14} />
            <span>Edit</span>
          </a>
        ) : null}
        {canReview ? (
          <>
            <button
              type="button"
              className="btn secondary sm"
              style={{ cursor: "pointer" }}
              disabled={pending !== undefined}
              onClick={() => act("approve")}
            >
              <Icon name="check" size={14} />
              <span>Approve</span>
            </button>
            <button
              type="button"
              className="btn secondary sm"
              style={{ cursor: "pointer" }}
              disabled={pending !== undefined}
              onClick={() => act("revise")}
            >
              <Icon name="pen" size={14} />
              <span>Revise</span>
            </button>
          </>
        ) : null}
      </div>
      {error ? <span style={{ color: "#C2363B", fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}
