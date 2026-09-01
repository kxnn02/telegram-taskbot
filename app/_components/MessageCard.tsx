import { Icon } from "./icons";

/** Faithful port of dashboardServer.ts's renderMessagePage body. */
export function MessageCard({
  title,
  message,
  backHref,
  backLabel,
}: {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="card" style={{ padding: 36 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "#FCE3E4",
          color: "#C2363B",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon name="alert" size={28} />
      </div>
      <div style={{ font: "700 20px/28px var(--font-sans)", color: "#0F172A" }}>{title}</div>
      <div style={{ font: "var(--md3-body-lg)", color: "#64748B", marginTop: 8 }}>{message}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
        <a className="btn secondary" href={backHref}>
          <Icon name="arrowLeft" size={16} />
          <span>{backLabel}</span>
        </a>
      </div>
    </div>
  );
}
