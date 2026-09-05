import type { GroupMode } from "../../src/web/oversightData";

/** Faithful port of the removed Express dashboard's renderControls. */
export function Controls({
  groupMode,
  assignees,
  activeAssignee,
}: {
  groupMode: GroupMode;
  assignees: string[];
  activeAssignee: string | undefined;
}) {
  const groupQuery = groupMode === "intern" ? "&group=intern" : "";
  return (
    <section className="panel" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="chiprow">
        <span className="chip-label">Group by</span>
        <div className="seg">
          <a className={groupMode === "action" ? "on" : ""} href="/?group=action">
            What it needs
          </a>
          <a className={groupMode === "intern" ? "on" : ""} href="/?group=intern">
            Member
          </a>
        </div>
      </div>
      <div className="chiprow">
        <span className="chip-label">Member</span>
        <a className={`chip${!activeAssignee ? " active" : ""}`} href={groupMode === "intern" ? "/?group=intern" : "/"}>
          All
        </a>
        {assignees.map((a) => (
          <a
            key={a}
            className={`chip${activeAssignee === a ? " active" : ""}`}
            href={`/?assignee=${encodeURIComponent(a)}${groupQuery}`}
          >
            @{a}
          </a>
        ))}
      </div>
    </section>
  );
}
