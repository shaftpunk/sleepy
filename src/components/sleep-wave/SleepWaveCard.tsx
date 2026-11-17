import { useId, useMemo, useState } from "react";
import type { DailySleepForecast, UpcomingDayForecast } from "../../analytics/dailySleepForecast";
import type { NextSleepPrediction } from "../../analytics/nextSleep";
import { buildSleepWaveModel, waveModelNow } from "../../analytics/sleepWaveModel";
import { sameDay } from "../../analytics/time";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock, formatDuration } from "../../lib/format";
import SleepWaveChart from "./SleepWaveChart";
import SleepWaveUpcoming from "./SleepWaveUpcoming";
import "./SleepWave.css";

type Props = { sessions: SleepSession[]; active: ActiveSleep | null; prediction: NextSleepPrediction;
  forecast?: DailySleepForecast | null; upcoming?: UpcomingDayForecast | null; now: number; babyName?: string };
export default function SleepWaveCard({ sessions, active, prediction, forecast = null, upcoming = null, now, babyName }: Props) {
  const { t, lang } = useTranslation();
  const titleId = useId(), summaryId = useId(), infoId = useId();
  const [infoOpen, setInfoOpen] = useState(false);
  // Decorative tile icons (CSS masks), so the card keeps a single SVG.
  const icon = (kind: "last" | "next" | "status" | "sun") => <span className={`sleep-wave-icon is-${kind}`} aria-hidden="true" />;
  const chartNow = useMemo(() => waveModelNow(sessions, active, now), [sessions, active, now]);
  const model = useMemo(() => buildSleepWaveModel({ sessions, active, prediction, forecast, now: chartNow }), [sessions, active, prediction, forecast, chartNow]);
  const window = model.forecasts[0];
  const range = (start: number, end: number) => {
    const changesOffset = new Date(start).getTimezoneOffset() !== new Date(end).getTimezoneOffset();
    const clock = (instant: number) => changesOffset
      ? new Intl.DateTimeFormat(LOCALES[lang], { hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(instant)
      : formatClock(instant, lang);
    const label = (instant: number) => sameDay(instant, now) ? clock(instant)
      : `${new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" }).format(instant)} ${clock(instant)}`;
    return `${label(start)}–${label(end)}`;
  };
  const last = model.lastCompleted;
  const sleeping = model.status === "sleeping";
  const later = model.predicted.filter(p => !p.isNext);
  const estimated = model.predicted.some(p => p.wave);
  // Shown only when the existing forecast supplies it; never estimated here.
  const awakeRange = prediction.status === "ready" && prediction.typicalAwakeMinutes
    && Number.isFinite(prediction.typicalAwakeMinutes.min) && Number.isFinite(prediction.typicalAwakeMinutes.max)
    ? prediction.typicalAwakeMinutes : null;
  // Compact card: the waves lead. Secondary copy lives in the info panel,
  // which stays in the DOM (visually hidden when closed) so screen readers
  // always get the full explanation.
  return <section className="sleep-wave" data-wave-state={model.status} aria-labelledby={titleId} aria-describedby={summaryId}>
    <header className="sleep-wave-header">
      <div><h2 id={titleId}>Sleep Wave</h2>
        <p className="sleep-wave-subtitle">{babyName ? t("sleepWave.rhythmFor", { name: babyName }) : t("sleepWave.rhythm")}</p></div>
      <span className="sleep-wave-today">{t("common.today")}</span>
    </header>
    <div className="sleep-wave-forecast">
      {window ? <>
        <h3>{t("home.nextSleepTitle")}</h3>
        <p className="sleep-wave-time">{range(window.startMs, window.endMs)}</p>
        <p className="sleep-wave-caption">{t("sleepWave.expectedOnset")}</p>
      </> : sleeping ? <>
        <h3>{t("sleepWave.sleepingTitle")}</h3>
        {model.active && <p className="sleep-wave-state-copy">{t("home.startedAt", { time: formatClock(model.active.startMs, lang) })}</p>}
      </> : <>
        <h3>{t("sleepWave.learningTitle")}</h3>
      </>}
    </div>
    <SleepWaveChart model={model} now={chartNow} formatRange={range} />
    <dl className="sleep-wave-events" id={summaryId}>
      <div data-tile="last">{icon("last")}<dt>{t("sleepWave.lastSleep")}</dt><dd>{last ? range(last.startMs, last.endMs) : t("common.notRegistered")}</dd></div>
      {window ? <div data-tile="next">{icon("next")}<dt>{t("sleepWave.nextOnset")}</dt><dd>{range(window.startMs, window.endMs)}</dd></div>
        : <div data-tile="status">{icon(sleeping ? "next" : "status")}<dt>{t("sleepWave.status")}</dt><dd>{sleeping ? t("common.sleeping") : t("common.notRegistered")}</dd></div>}
      {later[0] && <div data-tile="later">{icon("status")}<dt>{t("sleepWave.laterNap")}</dt><dd>{range(later[0].onset.startMs, later[0].onset.endMs)}</dd></div>}
    </dl>
    {window && awakeRange && <p className="sleep-wave-awake-range">{icon("sun")}<span>{t("sleepWave.typicalAwake")}</span>
      <strong>{awakeRange.min === awakeRange.max ? formatDuration(awakeRange.min, lang)
        : `${formatDuration(awakeRange.min, lang)}–${formatDuration(awakeRange.max, lang)}`}</strong></p>}
    {upcoming && upcoming.status !== "not_applicable" && <SleepWaveUpcoming forecast={upcoming} />}
    <div className="sleep-wave-footer">
      <div className="sleep-wave-legend" aria-hidden="true">
        <span><i className="is-recorded" />{t("sleepWave.recorded")}</span>
        {sleeping && <span><i className="is-active" />{t("common.sleeping")}</span>}
        {window && <span><i className="is-forecast" />{t("sleepWave.onsetWindow")}</span>}
        {estimated && <span><i className="is-estimated" />{t("sleepWave.estimatedSleep")}</span>}
        {model.compressed && <span><i className="is-compressed" />{t("sleepWave.nightCompressed")}</span>}
      </div>
      <button type="button" className="sleep-wave-info-button" aria-expanded={infoOpen} aria-controls={infoId}
        aria-label={t("sleepWave.about")} title={t("sleepWave.about")} onClick={() => setInfoOpen(open => !open)} />
    </div>
    <div id={infoId} className={`sleep-wave-info${infoOpen ? "" : " sleep-wave-sr"}`}>
      {!window && !sleeping && <p>{t("sleepWave.learningBody")}</p>}
      <p className="sleep-wave-note">{later.length || estimated ? t("sleepWave.forecastNote") : window ? t("sleepWave.onsetNote") : t("sleepWave.recordNote")}</p>
    </div>
    <div className="sleep-wave-accessible-history">
      <p>{t("sleepWave.recordedToday")}</p>
      {model.recorded.length ? <ul>{model.recorded.map((interval, i) => <li key={i}>{range(interval.startMs, interval.endMs)}</li>)}</ul>
        : <p>{t("common.notRegistered")}</p>}
      {model.active && <p>{t("sleepWave.activeSince", { time: formatClock(model.active.startMs, lang) })}</p>}
      {later.map(p => <p key={p.sequenceIndex}>{t("sleepWave.laterNapSummary", { range: range(p.onset.startMs, p.onset.endMs) })}</p>)}
    </div>
  </section>;
}
