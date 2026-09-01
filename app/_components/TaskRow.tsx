import { DateTime } from "luxon";
import type { TaskWithFlags } from "../../src/service/taskService";
import { initialsFor } from "../../src/web/layout";
import { StatusBadge } from "./StatusBadge";

/**
 * Faithful port of dashboardServer.ts's actionRow/internRow, minus the
 * trailing "Edit" action cell — task mutation (create/edit/approve) is
 * explicitly out of scope for this read-only slice (Phase 6.2), so the
 * whole actions column is dropped rather than rendered as an inert button.
 */

function dueLabel(dueDate: string): string {
  const dt = DateTime.fromISO(dueDate);
  return dt.isValid ? dt.toFormat("MMM d") : dueDate;
}

function DueCell({ task }: { task: TaskWithFlags }) {
  return (
    <td style={{ width: 116 }}>
      <div style={{ font: "600 14px/20px var(--font-sans)", color: task.overdue ? "#C2363B" : "#334155" }}>
        {dueLabel(task.dueDate)}
      </div>
      {task.overdue ? (
        <div style={{ font: "var(--md3-body-sm)", color: "#C2363B", marginTop: 3 }}>{task.daysOverdue}d late</div>
      ) : null}
    </td>
  );
}

export function ActionRow({ task }: { task: TaskWithFlags }) {
  return (
    <tr>
      <td style={{ width: 70 }}>
        <span className="id">#{task.id}</span>
      </td>
      <td>
        <div className="ttl">{task.title}</div>
        {task.blockedReason ? <div className="sub">{task.blockedReason}</div> : null}
      </td>
      <td style={{ width: 196 }}>
        <div className="cell-user">
          <div className="av sm">{initialsFor(task.assigneeUsername)}</div>
          <div className="nm sm">@{task.assigneeUsername}</div>
        </div>
      </td>
      <td style={{ width: 154 }}>
        <StatusBadge status={task.status} />
      </td>
      <DueCell task={task} />
    </tr>
  );
}

export function InternRow({ task }: { task: TaskWithFlags }) {
  return (
    <tr>
      <td style={{ width: 70 }}>
        <span className="id">#{task.id}</span>
      </td>
      <td>
        <div className="ttl">{task.title}</div>
        {task.blockedReason ? <div className="sub">{task.blockedReason}</div> : null}
      </td>
      <td style={{ width: 154 }}>
        <StatusBadge status={task.status} />
      </td>
      <DueCell task={task} />
    </tr>
  );
}
