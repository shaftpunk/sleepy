import { useId, useMemo, useState } from "react";
import { summarizeDataBasis } from "../../analytics/dataBasis";
import { FORECAST_RULES } from "../../analytics/dailySleepForecast";
import { ageInDays } from "../../analytics/localDate";
import { NEXT_SLEEP_LOOKBACK_DAYS } from "../../analytics/nextSleep";
import { computeForecastSleepProfile, PERSONAL_SLEEP_LOOKBACK_DAYS } from "../../analytics/personalSleepProfile";
import { MIN_SLEEP_PROBABILITY_DAYS } from "../../analytics/sleepProbability";
import { computeSleepPrediction } from "../../analytics/sleepPrediction";
import { buildSleepWaveModel, buildUpcomingDayWaveModel, waveModelNow } from "../../analytics/sleepWaveModel";
import { RECENT_PATTERN_DAYS, USABLE_DAY_RULE } from "../../analytics/sleepHistory";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { useSleepForecasts } from "../../hooks/useSleepForecasts";
import { useTranslation } from "../../i18n";

type Props = { sessions: SleepSession[]; active: ActiveSleep | null; now: number; birthDate: string | null };
type Readiness = "ready" | "building" | "insufficient" | "paused" | "recordedOnly";

export default function DataBasisTab({ sessions, active, now, birthDate }: Props) {
  const { t, locale } = useTranslation();
  const clockId = useId();
  const [time, setTime] = useState("10:00");
  const data = useMemo(() => summarizeDataBasis(sessions, active, now, time), [sessions, active, now, time]);
  const { nextSleep, dayForecast, upcomingForecast, nightForecast } = useSleepForecasts({ sessions, active, now, birthDate });
  const analysisNext = computeSleepPrediction({ sessions, active, now, ageDays: ageInDays(birthDate, now),
    profile: computeForecastSleepProfile(sessions, now) });
  const wave = buildSleepWaveModel({ sessions, active, prediction: nextSleep, forecast: dayForecast,
    now: waveModelNow(sessions, active, now) });
  const upcomingWave = buildUpcomingDayWaveModel(upcomingForecast);
  const waveReady = wave.forecasts.length > 0 || wave.predicted.length > 0 || upcomingWave !== null;
  const forecastReady = nightForecast ? upcomingForecast.status === "ready" : dayForecast?.status === "ready";
  const readiness = (status: string): Readiness =>
    status === "ready" ? "ready" : status === "sleeping" ? "paused" : "insufficient";
  const dates = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const window = { days: RECENT_PATTERN_DAYS };
  const status = data.usableDays === 0 ? data.usableSessions ? "building" : "insufficient"
    : data.confidence === "high" ? "strong" : data.confidence === "medium" ? "good" : "building";

  function model(title: string, state: Readiness, description: string, detail?: React.ReactNode) {
    return <li>
      <div className="data-basis-model-heading"><strong>{title}</strong><span className="status-chip">{t(`analysis.dataBasis.${state}`)}</span></div>
      <p className="muted">{description}</p>
      {detail}
    </li>;
  }

  return <div className="analysis-tab-content data-basis">
    <section className="analysis-card">
      <div className="data-basis-model-heading"><h2>{t("analysis.dataBasis.summary")}</h2><span className="status-chip">{t(`analysis.dataBasis.${status}`)}</span></div>
      <p className="muted">{t("analysis.dataBasis.scope", window)}</p>
      <dl className="mini-stats">
        <div><dt>{t("analysis.dataBasis.recorded")}</dt><dd>{data.recordedSessions}</dd></div>
        <div><dt>{t("analysis.dataBasis.usableSessions")}</dt><dd>{data.usableSessions}</dd></div>
      </dl>
      {active && <p className="muted">{t("analysis.dataBasis.active")}</p>}
      <h3>{t("analysis.dataBasis.coverage")}</h3>
      <p>{t("analysis.dataBasis.coverageCount", { ...window, count: data.usableDays })}</p>
      <ol className="data-basis-days" aria-label={t("analysis.dataBasis.coverage")}>
        {data.days.map(day => {
          const label = `${dates.format(day.startMs)}: ${t(`analysis.dataBasis.day_${day.state}`)}`;
          return <li key={day.localDate} data-state={day.state} title={label}><span className="sr-only">{label}</span></li>;
        })}
      </ol>
      <div className="data-basis-legend">
        {(["usable", "partial", "empty"] as const).map(state =>
          <span key={state}><i data-state={state} aria-hidden="true" />{t(`analysis.dataBasis.day_${state}`)}</span>)}
      </div>
      <p className="muted">{t("analysis.dataBasis.coverageNote", { intervals: USABLE_DAY_RULE.minimumIntervals, hours: USABLE_DAY_RULE.minimumSpanHours })}</p>
    </section>

    <section className="analysis-card">
      <h2>{t("analysis.dataBasis.models")}</h2>
      <p className="muted">{t("analysis.dataBasis.recency", window)}</p>
      <ul className="data-basis-models">
        {model(t("analysis.personalProfile.title"), data.profileReady ? "ready" : data.usableSessions ? "building" : "insufficient",
          t("analysis.dataBasis.profile", window))}
        {model(t("sleepProbability.title"), data.probability.insufficientData ? "insufficient" : "ready",
          t("analysis.dataBasis.probability", window), <>
            <label htmlFor={clockId}>{t("sleepProbability.localTime")}</label>{" "}
            <input id={clockId} type="time" value={time} onChange={event => { if (event.target.value) setTime(event.target.value); }} />
            <div aria-live="polite">
              <p>{t("analysis.dataBasis.progress", { count: data.probability.usableDays, minimum: MIN_SLEEP_PROBABILITY_DAYS })}</p>
              {data.probabilityDaysNeeded > 0 && <p>{t(data.probabilityDaysNeeded === 1 ? "analysis.dataBasis.oneMore" : "analysis.dataBasis.more", { count: data.probabilityDaysNeeded })}</p>}
            </div>
          </>)}
        {model(t("analysis.dataBasis.nextHome"), readiness(nextSleep.status),
          t("analysis.dataBasis.next", { days: NEXT_SLEEP_LOOKBACK_DAYS }))}
        {model(t("analysis.prediction.title"), readiness(analysisNext.status),
          t("analysis.dataBasis.nextOverview", { days: PERSONAL_SLEEP_LOOKBACK_DAYS }))}
        {model(t("analysis.dataBasis.dailyTitle"),
          forecastReady ? "ready" : dayForecast?.status === "partial" ? "building" : readiness(dayForecast?.status ?? upcomingForecast.status),
          t(nightForecast ? "analysis.dataBasis.upcoming" : "analysis.dataBasis.daily", { days: nightForecast ? RECENT_PATTERN_DAYS : FORECAST_RULES.lookbackDays }))}
        {model(t("analysis.dataBasis.waveTitle"), waveReady ? "ready" : "recordedOnly", t("analysis.dataBasis.wave"))}
        {model(t("analysis.insight.insightTitle"), data.insightsReady ? "ready" : "insufficient", t("analysis.dataBasis.insights"))}
      </ul>
    </section>
  </div>;
}
