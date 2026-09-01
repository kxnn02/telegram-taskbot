import { STATUS_GROUPS, type StatusGroup } from "../../src/web/taskView";

/** Faithful port of the removed Express dashboard's renderStatusChips — only
 * shown in `group=intern` mode, same as that dashboard. */
export function StatusChips({ activeStatus }: { activeStatus: StatusGroup | undefined }) {
  const options: Array<StatusGroup | "all"> = ["all", ...STATUS_GROUPS];
  return (
    <section className="panel" style={{ padding: "16px 20px" }}>
      <div className="chiprow">
        <span className="chip-label">Status</span>
        {options.map((s) => {
          const href = s === "all" ? "/?group=intern" : `/?group=intern&status=${s}`;
          const active = s === (activeStatus ?? "all");
          return (
            <a key={s} className={`chip${active ? " active" : ""}`} href={href}>
              {s}
            </a>
          );
        })}
      </div>
    </section>
  );
}
