import type { TaskWithFlags } from "../../src/service/taskService";
import { Icon, type IconName } from "./icons";

/** Faithful port of dashboardServer.ts's STATUS_META/statusBadge — same
 * colors, same icon-vocabulary, same tag-vs-badge distinction. */
type BadgeKind = "tag" | "badge";
const STATUS_META: Record<
  TaskWithFlags["status"],
  { kind: BadgeKind; bg: string; fg: string; ic: IconName; label: string }
> = {
  Assigned: { kind: "tag", bg: "", fg: "", ic: "hourglass", label: "Assigned" },
  InProgress: { kind: "badge", bg: "#E4EEFE", fg: "#1A5FCC", ic: "spark", label: "In progress" },
  Submitted: { kind: "badge", bg: "#FEF6D6", fg: "#9A6206", ic: "clock", label: "Submitted" },
  Approved: { kind: "badge", bg: "#DEF6EA", fg: "#0E7A4B", ic: "check", label: "Approved" },
  NeedsRevision: { kind: "badge", bg: "#FCE3E4", fg: "#C2363B", ic: "pen", label: "Needs revision" },
  Cancelled: { kind: "tag", bg: "", fg: "", ic: "alert", label: "Cancelled" },
};

export function StatusBadge({ status }: { status: TaskWithFlags["status"] }) {
  const meta = STATUS_META[status];
  if (meta.kind === "tag") {
    return (
      <span className="tag">
        <Icon name={meta.ic} size={12} />
        {meta.label}
      </span>
    );
  }
  return (
    <span className="badge" style={{ background: meta.bg, color: meta.fg }}>
      <Icon name={meta.ic} size={13} />
      {meta.label}
    </span>
  );
}
