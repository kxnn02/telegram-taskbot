import type { TaskWithFlags } from "../../src/service/taskService";
import { groupByAssignee } from "../../src/web/taskView";
import { initialsFor } from "../../src/web/layout";
import { InternRow } from "./TaskRow";

/** Faithful port of the removed Express dashboard's renderInternPanels. */
export function InternPanels({ tasks }: { tasks: TaskWithFlags[] }) {
  const grouped = groupByAssignee(tasks);
  const entries = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <p style={{ color: "var(--fg3)" }}>No tasks match this filter.</p>
      </section>
    );
  }

  return (
    <>
      {entries.map(([assignee, assigneeTasks]) => (
        <section className="panel" key={assignee}>
          <div className="panel-head">
            <div className="sec-head">
              <div className="cell-user">
                <div className="av">{initialsFor(assignee)}</div>
                <div className="nm">@{assignee}</div>
              </div>
            </div>
            <span className="count" style={{ background: "var(--slate-100)", color: "var(--fg2)" }}>
              {assigneeTasks.length}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Task</th>
                <th>Status</th>
                <th>Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assigneeTasks.map((t) => (
                <InternRow key={t.id} task={t} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
