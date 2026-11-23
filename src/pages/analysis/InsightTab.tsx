import { recordedAnalysisPeriod, computeNightVsDayBreakdown, computeQualityDistribution, generateInsights } from "../../analytics/insights";
import { formatDuration, stars } from "../../lib/format";
import { useTranslation } from "../../i18n";
import BarList, { type BarRow } from "../../components/analysis/BarList";
import { insightText } from "./insightText";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
  ageDays?: number | null;
  active?: ActiveSleep | null;
};

export default function InsightTab({ sessions, now, active = null, ageDays = null }: Props) {
  const { t, lang } = useTranslation();

  const recorded = recordedAnalysisPeriod(sessions, now);
  const quality = computeQualityDistribution(recorded);
  const nightVsDay = computeNightVsDayBreakdown(sessions, now);
  const insights = generateInsights(sessions, now, active, ageDays);

  const qualityRows: BarRow[] = quality
    .filter((row) => row.count > 0)
    .map((row) => ({
      key: String(row.rating),
      label: stars(row.rating),
      pctOfMax: row.pctOfMax,
      valueText: String(row.count),
      detailText: t("analysis.insight.ofRated", { pct: Math.round(row.sharePct) }),
    }));

  return (
    <div className="analysis-tab-content">
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.insight.patternsLabel")}</p>
            <h2>{t("analysis.insight.insightTitle")}</h2>
          </div>
        </div>

        {insights.length === 0 ? <p className="muted">{t("analysis.insights.fallbackNoData")}</p> : <div className="insight-list">
          {insights.map((insight) => (
            <p className="insight-row" key={insight.id} data-insight={insight.id}>
              {insightText(insight, t, lang)}
            </p>
          ))}
        </div>}
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.insight.ratingsLabel")}</p>
            <h2>{t("analysis.insight.qualityDistribution")}</h2>
          </div>
        </div>

        <BarList rows={qualityRows} emptyText={t("analysis.insight.noRatedSleepYet")} />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.insight.distributionLabel")}</p>
            <h2>{t("analysis.insight.nightVsDay")}</h2>
          </div>
        </div>

        <div className="mini-stats">
          {nightVsDay.map((row) => (
            <div key={row.label}>
              <span>{t(row.label === "night" ? "analysis.insight.night" : "analysis.insight.daySleep")}</span>
              <strong>{formatDuration(row.totalMinutes, lang)}</strong>
              <small>
                {t("analysis.day.sessionsCount", { count: row.sessionCount })} ·{" "}
                {Math.round(row.sharePct)}%
              </small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
