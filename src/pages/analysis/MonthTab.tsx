import { computeMonthlyBars, computeMonthSummary } from "../../analytics/month";
import { dayKeyOf } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
};

function tooltipFor(dayKey: string, totalMinutes: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "short" }).format(date);

  return totalMinutes > 0 ? `${label}: ${formatDuration(totalMinutes)}` : `${label}: ingen søvn`;
}

function axisLabel(dayKey: string, now: number): string {
  if (dayKey === dayKeyOf(now)) return "I dag";

  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit" }).format(
    new Date(y, m - 1, d)
  );
}

export default function MonthTab({ sessions, now }: Props) {
  const bars = computeMonthlyBars(sessions, now);
  const summary = computeMonthSummary(bars);

  const midIndex = Math.floor(bars.length / 2);

  return (
    <div className="analysis-tab-content">
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Siste 30 dager</p>
            <h2>Søvn per dag</h2>
          </div>

          <div className="month-total-badge">{formatDuration(summary.totalMinutes)}</div>
        </div>

        <div className="month-bar-grid">
          {bars.map((bar) => (
            <div
              key={bar.dayKey}
              className={`month-bar month-bar-${bar.tier}`}
              style={{ height: `${Math.max(bar.pctOfMax, bar.tier === "empty" ? 2 : 4)}%` }}
              title={tooltipFor(bar.dayKey, bar.totalMinutes)}
            />
          ))}
        </div>

        <div className="month-axis">
          <span>{axisLabel(bars[0].dayKey, now)}</span>
          <span>{axisLabel(bars[midIndex].dayKey, now)}</span>
          <span>{axisLabel(bars[bars.length - 1].dayKey, now)}</span>
        </div>

        <div className="month-footer">
          <div>
            <span>Snitt per dag</span>
            <strong>
              {summary.avgPerDayWithData != null ? formatDuration(summary.avgPerDayWithData) : "-"}
            </strong>
          </div>

          <div>
            <span>Beste dag</span>
            <strong>
              {summary.bestDay
                ? `${axisLabel(summary.bestDay.dayKey, now)} · ${formatDuration(summary.bestDay.totalMinutes)}`
                : "-"}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
