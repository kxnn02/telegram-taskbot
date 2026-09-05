import type { CohortStats } from "../../src/service/taskService";
import { buildStatsViewModel } from "../../src/web/statsView";
import { initialsFor } from "../../src/web/layout";
import { Icon, type IconName } from "./icons";

/** Faithful port of the removed Express dashboard's statCard/renderStatsPage,
 * minus the Express-specific HTML string building — formatting itself is
 * delegated to `buildStatsViewModel` (unit-tested directly). */
function StatCard({ label, value, ic, bg, fg }: { label: string; value: string; ic: IconName; bg: string; fg: string }) {
  return (
    <div className="stat">
      <div className="ic" style={{ background: bg, color: fg }}>
        <Icon name={ic} size={20} />
      </div>
      <div className="v" style={{ color: "#0F172A" }}>
        {value}
      </div>
      <div className="k">{label}</div>
    </div>
  );
}

export function StatsView({ stats }: { stats: CohortStats }) {
  const model = buildStatsViewModel(stats);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 16 }}>
        <StatCard label="Completion rate" value={model.completionRatePercentLabel} ic="check" bg="#DEF6EA" fg="#0E7A4B" />
        <StatCard
          label="Completed this week"
          value={String(model.completedThisWeek)}
          ic="spark"
          bg="#E4EEFE"
          fg="#1A5FCC"
        />
        <StatCard label="Average time to submit" value={model.averageTimeToSubmitLabel} ic="hourglass" bg="#FEF6D6" fg="#946008" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2 style={{ color: "#0F172A" }}>Tasks completed per member</h2>
        </div>
        <table>
          <tbody>
            {model.memberBars.length === 0 ? (
              <tr>
                <td style={{ padding: "14px 20px" }}>No members in this cohort.</td>
              </tr>
            ) : (
              model.memberBars.map((bar) => (
                <tr key={bar.username}>
                  <td>
                    <div className="cell-user">
                      <div className="av">{initialsFor(bar.username)}</div>
                      <div className="nm">@{bar.username}</div>
                    </div>
                  </td>
                  <td style={{ width: 300 }}>
                    <div className="bar">
                      <div className="fill" style={{ width: `${bar.widthPercent}%`, background: "#4263EB" }} />
                    </div>
                  </td>
                  <td style={{ width: 110, textAlign: "right" }}>
                    <span style={{ font: "600 15px/22px var(--font-sans)", color: "#0F172A" }}>{bar.completed}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
