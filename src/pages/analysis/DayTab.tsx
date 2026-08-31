import { computeHourlyDistribution, computeSleepPerDayLast7, computeWakeWindowsThroughDay } from "../../analytics/day";
import { dayKeyOf, two } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import BarList, { type BarRow, type BarRowTone } from "../../components/analysis/BarList";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
};

function dayBarLabel(dayKey: string, now: number): string {
  if (dayKey === dayKeyOf(now)) return "I dag";

  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  return new Intl.DateTimeFormat("nb-NO", { weekday: "short" }).format(date);
}

function toneForDayBar(totalMinutes: number, pctOfMax: number): BarRowTone {
  if (totalMinutes === 0) return "neutral";
  if (pctOfMax >= 80) return "success";
  if (pctOfMax >= 50) return "info";
  return "warning";
}

const WAKE_WINDOW_GROUP_LABELS: Record<string, string> = {
  "1st": "1. vindu",
  "2nd": "2. vindu",
  "3rd": "3. vindu",
  "4th+": "4.+ vindu",
};

export default function DayTab({ sessions, now }: Props) {
  const perDay = computeSleepPerDayLast7(sessions, now);
  const buckets = computeHourlyDistribution(sessions, now);
  const wakeThroughDay = computeWakeWindowsThroughDay(sessions);

  const perDayRows: BarRow[] = perDay.map((day) => ({
    key: day.dayKey,
    label: dayBarLabel(day.dayKey, now),
    pctOfMax: day.pctOfMax,
    valueText: day.totalMinutes > 0 ? formatDuration(day.totalMinutes) : "-",
    detailText: `${day.sessionCount} økter`,
    tone: toneForDayBar(day.totalMinutes, day.pctOfMax),
  }));

  const busiestMinutes = buckets.bucketMinutes[buckets.busiestIndex];
  const bucketRows: BarRow[] = buckets.bucketMinutes.map((minutes, i) => ({
    key: String(i),
    label: `${two(i * 3)}–${two(i * 3 + 3)}`,
    pctOfMax: busiestMinutes > 0 ? (minutes / busiestMinutes) * 100 : 0,
    valueText:
      buckets.totalMinutes > 0 ? `${Math.round((minutes / buckets.totalMinutes) * 100)}%` : "-",
  }));

  return (
    <div className="analysis-tab-content">
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Siste 7 dager</p>
            <h2>Søvn per dag</h2>
          </div>
        </div>

        <BarList rows={perDayRows} emptyText="Ingen søvn registrert ennå." />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Siste 30 dager</p>
            <h2>Når de pleier å sove</h2>
          </div>
        </div>

        <BarList rows={bucketRows} emptyText="Ingen søvn registrert ennå." />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Gjennom dagen</p>
            <h2>Våkenvinduer</h2>
          </div>
        </div>

        {wakeThroughDay.groups.every((g) => g.count === 0) ? (
          <div className="empty-card">Ikke nok data ennå.</div>
        ) : (
          <div className="wake-window-rows">
            {wakeThroughDay.groups.map((group) => (
              <div className="wake-window-row" key={group.label}>
                <span>{WAKE_WINDOW_GROUP_LABELS[group.label]}</span>
                <strong>
                  {group.medianMinutes != null ? formatDuration(group.medianMinutes) : "-"}
                </strong>
                <small>{group.count} ganger</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
