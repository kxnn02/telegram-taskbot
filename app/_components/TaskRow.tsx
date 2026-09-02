import { DateTime } from "luxon";
import type { TaskWithFlags } from "../../src/service/taskService";
import { initialsFor } from "../../src/web/layout";
import { RowActions } from "./RowActions";
import { StatusBadge } from "./StatusBadge";

/**
 * Faithful port of the removed Express dashboard's actionRow/internRow. Phase 6.1
 * dropped the trailing actions cell entirely (mutations were out of scope
 * for that read-only slice); Phase 6.2 brings it back as `RowActions`, a
 * Client Component that calls the new REST mutation routes.
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

export function ActionRow({ task, canEdit }: { task: TaskWithFlags; canEdit: boolean }) {
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
      <td style={{ width: 168 }}>
        <RowActions task={task} canEdit={canEdit} />
      </td>
    </tr>
  );
}

export function InternRow({ task, canEdit }: { task: TaskWithFlags; canEdit: boolean }) {
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
      <td style={{ width: 168 }}>
        <RowActions task={task} canEdit={canEdit} />
      </td>
    </tr>
  );
}
