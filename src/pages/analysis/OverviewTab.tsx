import { computeKpis, computeRhythmCard, computeWeeklyTrend, computeWindowAverage } from "../../analytics/overview";
import { ageInDays } from "../../analytics/localDate";
import { getGuidelineForAgeDays } from "../../analytics/sleepGuidelines";
import { minutesToClockLabel } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { useTranslation } from "../../i18n";
import KpiCard from "../../components/analysis/KpiCard";
import AgeSleepGuideCard from "../../components/analysis/AgeSleepGuideCard";
import PersonalSleepProfileCard from "../../components/analysis/PersonalSleepProfileCard";
import NextSleepPredictionCard from "../../components/analysis/NextSleepPredictionCard";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  active: ActiveSleep | null;
  birthDate: string | null;
  now: number;
};

export default function OverviewTab({ sessions, active, birthDate, now }: Props) {
  const { t, lang } = useTranslation();

  const sevenDayAvg = computeWindowAverage(sessions, now, 7);
  const trend = computeWeeklyTrend(sessions, now);
  const kpis = computeKpis(sessions, now);
  const rhythm = computeRhythmCard(sessions);

  const ageDays = ageInDays(birthDate, now);
  const guidelineLookup = getGuidelineForAgeDays(ageDays);
  const guideline = guidelineLookup.status === "found" ? guidelineLookup.guideline : null;

  return (
    <div className="analysis-tab-content">
      <AgeSleepGuideCard birthDate={birthDate} sessions={sessions} active={active} now={now} />

      <PersonalSleepProfileCard sessions={sessions} guideline={guideline} now={now} />

      <NextSleepPredictionCard sessions={sessions} active={active} now={now} ageDays={ageDays} />

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.overview.last7Days")}</p>
            <h2>{t("analysis.overview.avgSleepTitle")}</h2>
          </div>
        </div>

        <div className="overview-average">
          {sevenDayAvg.avgMinutes != null ? formatDuration(sevenDayAvg.avgMinutes, lang) : "-"}
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
              t("analysis.overview.trendSame")}

            {trend.direction === "more" &&
              t("analysis.overview.trendMore", {
                duration: formatDuration(Math.abs(trend.diffMinutes), lang),
              })}

            {trend.direction === "less" &&
              t("analysis.overview.trendLess", {
                duration: formatDuration(Math.abs(trend.diffMinutes), lang),
              })}
          </div>
        )}
      </section>

      <section className="stats-grid">
        <KpiCard
          label={t("analysis.overview.longestSleep")}
          value={formatDuration(kpis.longestMinutes, lang)}
        />
        <KpiCard
          label={t("analysis.overview.atNight")}
          value={kpis.atNightPct != null ? `${Math.round(kpis.atNightPct)}%` : "-"}
        />
        <KpiCard
          label={t("analysis.overview.napsPerDay")}
          value={kpis.napsPerDay != null ? kpis.napsPerDay.toFixed(1) : "-"}
        />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.overview.rhythmLabel")}</p>
            <h2>{t("analysis.overview.rhythmTitle")}</h2>
          </div>
        </div>

        <div className="mini-stats">
          <div>
            <span>{t("analysis.overview.bedtime")}</span>
            <strong>
              {rhythm.bedtimeMin != null ? minutesToClockLabel(rhythm.bedtimeMin) : "-"}
            </strong>
          </div>

          <div>
            <span>{t("analysis.overview.wakeTime")}</span>
            <strong>
              {rhythm.wakeMin != null ? minutesToClockLabel(rhythm.wakeMin) : "-"}
            </strong>
          </div>

          <div>
            <span>{t("analysis.overview.wakeWindow")}</span>
            <strong>
              {rhythm.medianWakeWindowMinutes != null
                ? formatDuration(rhythm.medianWakeWindowMinutes, lang)
                : "-"}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
