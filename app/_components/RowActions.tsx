"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TaskWithFlags } from "../../src/service/taskService";
import { Icon } from "./icons";

/** #27's normative status table — the six free-set statuses any roster
 * member may set on any task, mirroring what the bot's `/update` does. */
const STATUS_OPTIONS: Array<{ value: TaskWithFlags["status"]; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

/**
 * Per-row actions for the oversight table (Phase 6.2, issue #17; redesigned
 * for the free-set status model, issue #27/#29). The Approve/Revise buttons
 * and their `canReview = status === "in_review"` gate encoded the deleted
 * review gate and are gone; in their place, a status dropdown lets any
 * roster member set any of the six statuses directly, via the same
 * `PATCH /api/tasks/:id` route `TaskForm` already uses (extended to accept
 * an optional `status` field). There is no access-control gate any more
 * (ADR-0013) — `canEdit` is always true, kept as a prop rather than
 * removed outright since nothing in this ticket asks for that plumbing to
 * be restructured.
 */
export function RowActions({
  task,
  canEdit,
}: {
  task: Pick<TaskWithFlags, "id" | "status">;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function changeStatus(status: TaskWithFlags["status"]) {
    if (status === task.status) return;
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!data.ok) {
        setError(data.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="row-actions" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {canEdit ? (
          <a className="btn secondary sm" href={`/tasks/${task.id}/edit`}>
            <Icon name="pen" size={14} />
            <span>Edit</span>
          </a>
        ) : null}
        <select
          aria-label={`Change status of task ${task.id}`}
          value={task.status}
          disabled={pending}
          onChange={(e) => changeStatus(e.target.value as TaskWithFlags["status"])}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {error ? <span style={{ color: "#C2363B", fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}
