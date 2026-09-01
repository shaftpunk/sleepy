import { computeHourlyDistribution, computeSleepPerDayLast7, computeWakeWindowsThroughDay } from "../../analytics/day";
import { dayKeyOf, two } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { LOCALES, useTranslation, type Language } from "../../i18n";
import BarList, { type BarRow, type BarRowTone } from "../../components/analysis/BarList";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
};

function dayBarLabel(dayKey: string, now: number, lang: Language, todayLabel: string): string {
  if (dayKey === dayKeyOf(now)) return todayLabel;

  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short" }).format(date);
}

function toneForDayBar(totalMinutes: number, pctOfMax: number): BarRowTone {
  if (totalMinutes === 0) return "neutral";
  if (pctOfMax >= 80) return "success";
  if (pctOfMax >= 50) return "info";
  return "warning";
}

export default function DayTab({ sessions, now }: Props) {
  const { t, lang } = useTranslation();

  const windowGroupLabels: Record<string, string> = {
    "1st": t("analysis.day.windowGroup1"),
    "2nd": t("analysis.day.windowGroup2"),
    "3rd": t("analysis.day.windowGroup3"),
    "4th+": t("analysis.day.windowGroup4plus"),
  };

  const perDay = computeSleepPerDayLast7(sessions, now);
  const buckets = computeHourlyDistribution(sessions, now);
  const wakeThroughDay = computeWakeWindowsThroughDay(sessions);

  const todayLabel = t("common.today");

  const perDayRows: BarRow[] = perDay.map((day) => ({
    key: day.dayKey,
    label: dayBarLabel(day.dayKey, now, lang, todayLabel),
    pctOfMax: day.pctOfMax,
    valueText: day.totalMinutes > 0 ? formatDuration(day.totalMinutes, lang) : "-",
    detailText: t("analysis.day.sessionsCount", { count: day.sessionCount }),
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
            <p className="card-label">{t("analysis.overview.last7Days")}</p>
            <h2>{t("analysis.day.sleepPerDay")}</h2>
          </div>
        </div>

        <BarList rows={perDayRows} emptyText={t("analysis.day.noSleepYet")} />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.day.last30Days")}</p>
            <h2>{t("analysis.day.whenTheyUsuallySleep")}</h2>
          </div>
        </div>

        <BarList rows={bucketRows} emptyText={t("analysis.day.noSleepYet")} />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.day.throughTheDay")}</p>
            <h2>{t("analysis.day.wakeWindows")}</h2>
          </div>
        </div>

        {wakeThroughDay.groups.every((g) => g.count === 0) ? (
          <div className="empty-card">{t("analysis.day.notEnoughData")}</div>
        ) : (
          <div className="wake-window-rows">
            {wakeThroughDay.groups.map((group) => (
              <div className="wake-window-row" key={group.label}>
                <span>{windowGroupLabels[group.label]}</span>
                <strong>
                  {group.medianMinutes != null ? formatDuration(group.medianMinutes, lang) : "-"}
                </strong>
                <small>{t("analysis.day.timesCount", { count: group.count })}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
