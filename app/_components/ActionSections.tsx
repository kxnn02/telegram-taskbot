import type { TaskWithFlags } from "../../src/service/taskService";
import { groupByAction, ACTION_GROUPS, type ActionGroup, type StatusGroup } from "../../src/web/taskView";
import { Icon, type IconName } from "./icons";
import { ActionRow } from "./TaskRow";

/** Faithful port of the removed Express dashboard's ACTION_SECTION_META/renderActionSection. */
interface ActionSectionMeta {
  label: string;
  ic: IconName;
  bg: string;
  fg: string;
  statusLink?: StatusGroup;
  collapsed?: boolean;
}

const ACTION_SECTION_META: Record<ActionGroup, ActionSectionMeta> = {
  "needs-review": {
    label: "Needs your review",
    ic: "clock",
    bg: "#FEF6D6",
    fg: "#9A6206",
    statusLink: "to-be-reviewed",
  },
  blocked: { label: "Blocked", ic: "lock", bg: "#E2E8F0", fg: "#1E2A56", statusLink: "blocked" },
  overdue: { label: "Overdue", ic: "alert", bg: "#FCE3E4", fg: "#C2363B", statusLink: "overdue" },
  done: { label: "Done", ic: "check", bg: "#DEF6EA", fg: "#0E7A4B", statusLink: "done", collapsed: true },
  open: { label: "Open", ic: "spark", bg: "#E4EEFE", fg: "#1A5FCC" },
};

function Section({
  meta,
  tasks,
  canEdit,
}: {
  meta: ActionSectionMeta;
  tasks: TaskWithFlags[];
  canEdit: boolean;
}) {
  const headingInner = (
    <>
      <div className="sec-ic" style={{ background: meta.bg, color: meta.fg }}>
        <Icon name={meta.ic} size={19} />
      </div>
      <h2 style={{ color: "#0F172A" }}>{meta.label}</h2>
    </>
  );
  return (
    <section className="panel">
      <div className="panel-head">
        {meta.statusLink ? (
          <a className="sec-head" style={{ color: "inherit" }} href={`/?status=${meta.statusLink}`}>
            {headingInner}
          </a>
        ) : (
          <div className="sec-head">{headingInner}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="count" style={{ background: meta.bg, color: meta.fg }}>
            {tasks.length}
          </span>
          {meta.collapsed ? <Icon name="chevronDown" size={18} /> : null}
        </div>
      </div>
      {meta.collapsed ? null : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Task</th>
              <th>Intern</th>
              <th>Status</th>
              <th>Due</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <ActionRow key={t.id} task={t} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ActionSections({ tasks, canEdit }: { tasks: TaskWithFlags[]; canEdit: boolean }) {
  const grouped = groupByAction(tasks);
  return (
    <>
      {ACTION_GROUPS.map((g) => (
        <Section key={g} meta={ACTION_SECTION_META[g]} tasks={grouped.get(g) ?? []} canEdit={canEdit} />
      ))}
    </>
  );
}
