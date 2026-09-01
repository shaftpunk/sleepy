import { computeMonthlyBars, computeMonthSummary } from "../../analytics/month";
import { dayKeyOf } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { LOCALES, useTranslation, type Language } from "../../i18n";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
};

function tooltipFor(
  dayKey: string,
  totalMinutes: number,
  lang: Language,
  noSleepLabel: string
): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = new Intl.DateTimeFormat(LOCALES[lang], { day: "2-digit", month: "short" }).format(
    date
  );

  return totalMinutes > 0
    ? `${label}: ${formatDuration(totalMinutes, lang)}`
    : `${label}: ${noSleepLabel}`;
}

function axisLabel(dayKey: string, now: number, lang: Language, todayLabel: string): string {
  if (dayKey === dayKeyOf(now)) return todayLabel;

  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALES[lang], { day: "2-digit", month: "2-digit" }).format(
    new Date(y, m - 1, d)
  );
}

export default function MonthTab({ sessions, now }: Props) {
  const { t, lang } = useTranslation();

  const bars = computeMonthlyBars(sessions, now);
  const summary = computeMonthSummary(bars);

  const midIndex = Math.floor(bars.length / 2);
  const todayLabel = t("common.today");
  const noSleepLabel = t("analysis.month.noSleep");

  return (
    <div className="analysis-tab-content">
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.month.last30Days")}</p>
            <h2>{t("analysis.month.sleepPerDay")}</h2>
          </div>

          <div className="month-total-badge">{formatDuration(summary.totalMinutes, lang)}</div>
        </div>

        <div className="month-bar-grid">
          {bars.map((bar) => (
            <div
              key={bar.dayKey}
              className={`month-bar month-bar-${bar.tier}`}
              style={{ height: `${Math.max(bar.pctOfMax, bar.tier === "empty" ? 2 : 4)}%` }}
              title={tooltipFor(bar.dayKey, bar.totalMinutes, lang, noSleepLabel)}
            />
          ))}
        </div>

        <div className="month-axis">
          <span>{axisLabel(bars[0].dayKey, now, lang, todayLabel)}</span>
          <span>{axisLabel(bars[midIndex].dayKey, now, lang, todayLabel)}</span>
          <span>{axisLabel(bars[bars.length - 1].dayKey, now, lang, todayLabel)}</span>
        </div>

        <div className="month-footer">
          <div>
            <span>{t("analysis.month.avgPerDay")}</span>
            <strong>
              {summary.avgPerDayWithData != null
                ? formatDuration(summary.avgPerDayWithData, lang)
                : "-"}
            </strong>
          </div>

          <div>
            <span>{t("analysis.month.bestDay")}</span>
            <strong>
              {summary.bestDay
                ? `${axisLabel(summary.bestDay.dayKey, now, lang, todayLabel)} · ${formatDuration(summary.bestDay.totalMinutes, lang)}`
                : "-"}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
