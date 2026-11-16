import { useId, useMemo } from "react";
import type { NextSleepPrediction } from "../../analytics/nextSleep";
import { buildSleepWaveModel } from "../../analytics/sleepWaveModel";
import { sameDay } from "../../analytics/time";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock } from "../../lib/format";
import SleepWaveChart from "./SleepWaveChart";
import "./SleepWave.css";

type Props = { sessions: SleepSession[]; active: ActiveSleep | null; prediction: NextSleepPrediction; now: number; babyName?: string };
export default function SleepWaveCard({ sessions, active, prediction, now, babyName }: Props) {
  const { t, lang } = useTranslation();
  const titleId = useId(), summaryId = useId();
  const latestEnd = useMemo(() => sessions.reduce((last, session) => Number.isFinite(session.endMs)
    ? Math.max(last, session.endMs) : last, 0), [sessions]);
  // Reuse Home's clock, but update geometry only each minute or on a new record.
  // Keep a just-started/ended interval visible immediately within that minute.
  const chartNow = Math.max(Math.floor(now / 60000) * 60000,
    latestEnd <= now ? latestEnd : 0, active && active.startMs <= now ? active.startMs : 0);
  const model = useMemo(() => buildSleepWaveModel({ sessions, active, prediction, now: chartNow }), [sessions, active, prediction, chartNow]);
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
  return <section className="sleep-wave" data-wave-state={model.status} aria-labelledby={titleId} aria-describedby={summaryId}>
    <header className="sleep-wave-header">
      <div><h2 id={titleId}>Sleep Wave</h2><p>{babyName ? t("sleepWave.rhythmFor", { name: babyName }) : t("sleepWave.rhythm")}</p></div>
      <span className="sleep-wave-today">{t("common.today")}</span>
    </header>
    <div className="sleep-wave-forecast">
      {window ? <>
        <h3>{t("home.nextSleepTitle")}</h3>
        <p className="sleep-wave-time">{range(window.startMs, window.endMs)}</p>
        <p className="sleep-wave-caption">{t("sleepWave.expectedOnset")}</p>
      </> : sleeping ? <>
        <h3>{t("sleepWave.sleepingTitle")}</h3>
        <p className="sleep-wave-state-copy">{t("sleepWave.resting")}</p>
      </> : <>
        <h3>{t("sleepWave.learningTitle")}</h3>
        <p className="sleep-wave-state-copy">{t("sleepWave.learningBody")}</p>
      </>}
    </div>
    <SleepWaveChart model={model} />
    <div className="sleep-wave-legend" aria-hidden="true">
      <span><i className="is-recorded" />{t("sleepWave.recorded")}</span>
      {sleeping && <span><i className="is-active" />{t("common.sleeping")}</span>}
      {window && <span><i className="is-forecast" />{t("sleepWave.onsetWindow")}</span>}
    </div>
    <dl className="sleep-wave-events" id={summaryId}>
      <div><dt>{t("sleepWave.lastSleep")}</dt><dd>{last ? range(last.startMs, last.endMs) : t("common.notRegistered")}</dd></div>
      <div><dt>{t("sleepWave.status")}</dt><dd>{sleeping ? t("common.sleeping") : window ? t("common.awake") : t("common.notRegistered")}</dd></div>
      {window && <div><dt>{t("sleepWave.nextOnset")}</dt><dd>{range(window.startMs, window.endMs)}</dd></div>}
    </dl>
    <p className="sleep-wave-note">{window ? t("sleepWave.onsetNote") : t("sleepWave.recordNote")}</p>
    <div className="sleep-wave-accessible-history">
      <p>{t("sleepWave.recordedToday")}</p>
      {model.recorded.length ? <ul>{model.recorded.map((interval, i) => <li key={i}>{range(interval.startMs, interval.endMs)}</li>)}</ul>
        : <p>{t("common.notRegistered")}</p>}
      {model.active && <p>{t("sleepWave.activeSince", { time: formatClock(model.active.startMs, lang) })}</p>}
    </div>
  </section>;
}
