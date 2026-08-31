import { computeKpis, computeRhythmCard, computeWeeklyTrend, computeWindowAverage } from "../../analytics/overview";
import { minutesToClockLabel } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import KpiCard from "../../components/analysis/KpiCard";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
};

export default function OverviewTab({ sessions, now }: Props) {
  const sevenDayAvg = computeWindowAverage(sessions, now, 7);
  const trend = computeWeeklyTrend(sessions, now);
  const kpis = computeKpis(sessions, now);
  const rhythm = computeRhythmCard(sessions);

  return (
    <div className="analysis-tab-content">
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Siste 7 dager</p>
            <h2>Snitt søvn</h2>
          </div>
        </div>

        <div className="overview-average">
          {sevenDayAvg.avgMinutes != null ? formatDuration(sevenDayAvg.avgMinutes) : "-"}
        </div>

        {trend.direction !== "insufficient-history" && (
          <div
            className={
              trend.direction === "same"
                ? "trend-chip neutral"
                : trend.direction === "more"
                  ? "trend-chip positive"
                  : "trend-chip warning"
            }
          >
            {trend.direction === "same" &&
              "Omtrent som forrige uke"}

            {trend.direction === "more" &&
              `▲ ${formatDuration(Math.abs(trend.diffMinutes))} mer enn forrige uke`}

            {trend.direction === "less" &&
              `▼ ${formatDuration(Math.abs(trend.diffMinutes))} mindre enn forrige uke`}
          </div>
        )}
      </section>

      <section className="stats-grid">
        <KpiCard label="Lengste søvn" value={formatDuration(kpis.longestMinutes)} />
        <KpiCard
          label="Om natten"
          value={kpis.atNightPct != null ? `${Math.round(kpis.atNightPct)}%` : "-"}
        />
        <KpiCard
          label="Lurer per dag"
          value={kpis.napsPerDay != null ? kpis.napsPerDay.toFixed(1) : "-"}
        />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Rytme</p>
            <h2>Leggetid og oppvåkning</h2>
          </div>
        </div>

        <div className="mini-stats">
          <div>
            <span>Leggetid</span>
            <strong>
              {rhythm.bedtimeMin != null ? minutesToClockLabel(rhythm.bedtimeMin) : "-"}
            </strong>
          </div>

          <div>
            <span>Våkner</span>
            <strong>
              {rhythm.wakeMin != null ? minutesToClockLabel(rhythm.wakeMin) : "-"}
            </strong>
          </div>

          <div>
            <span>Våkenvindu</span>
            <strong>
              {rhythm.medianWakeWindowMinutes != null
                ? formatDuration(rhythm.medianWakeWindowMinutes)
                : "-"}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
