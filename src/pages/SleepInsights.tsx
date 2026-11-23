import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { parseLocalDateOnly } from "../analytics/localDate";
import { buildSleepInsights, sleepInsightsWindow, type InsightDay } from "../analytics/sleepInsights";
import SleepyIcon from "../components/SleepyIcon";
import { LOCALES, useTranslation } from "../i18n";
import { formatDuration } from "../lib/format";
import { getSleepsOverlappingPeriod, type SleepRecord } from "../services/sleepService";
import { subscribeToSleepChanges } from "../services/sleepRealtime";
import { useAppStore } from "../stores/appStore";
import "./SleepInsights.css";

export default function SleepInsights() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const babies = useAppStore(state => state.babies);
  const babyId = useAppStore(state => state.currentBabyId);
  const setBaby = useAppStore(state => state.setCurrentBabyId);
  const baby = babies.find(child => child.id === babyId);
  return <main className="sleep-insights">
    <header className="sleep-insights-header">
      <Link to={{ pathname: "/log", search: params.toString() }} aria-label={t("nav.log")}>&lsaquo;</Link>
      <div>
        <h1>{t("sleepInsights.title")}</h1>
        {babies.length > 1 && <div className="sleep-insights-baby"><select aria-label={t("settings.babyTitle")} value={babyId ?? ""} onChange={event => setBaby(event.target.value)}>
          {!babyId && <option value="" disabled>&mdash;</option>}
          {babies.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
        </select><SleepyIcon name="chevron" /></div>}
        {babies.length === 1 && <p>{baby?.name}</p>}
      </div>
    </header>
    {babyId && <SleepHistory key={babyId} babyId={babyId} />}
  </main>;
}

function SleepHistory({ babyId }: { babyId: string }) {
  const { t, lang } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const [rows, setRows] = useState<SleepRecord[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { startMs } = sleepInsightsWindow(now);

  useEffect(() => {
    let current = true;
    let request = 0;
    async function load() {
      const version = ++request;
      const time = Date.now();
      setNow(time);
      const from = new Date(sleepInsightsWindow(time).startMs).toISOString();
      const to = new Date(time).toISOString();
      try {
        const history: SleepRecord[] = [];
        const size = 500;
        for (let offset = 0; ; offset += size) {
          const page = await getSleepsOverlappingPeriod(babyId, from, to, { offset, size });
          if (!current || version !== request) return;
          history.push(...page);
          if (page.length < size) break;
        }
        setRows(history);
        setFailed(false);
      } catch {
        if (current && version === request) setFailed(true);
      }
    }
    function resume() { if (!document.hidden) void load(); }
    const unsubscribe = subscribeToSleepChanges(babyId, load);
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("resume", resume);
    return () => {
      current = false;
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("resume", resume);
    };
  }, [babyId, startMs, attempt]);

  if (failed) return <section className="sleep-insights-card">
    <p role="status">{t("sleepInsights.unavailable")}</p>
    <button className="secondary-button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t("common.retry")}</button>
  </section>;
  if (!rows) return <p role="status">{t("common.loading")}</p>;

  const { last7, last30, weeks, scaleMinutes } = buildSleepInsights(rows, babyId, now);
  const dates = new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" });
  const label = (key: string) => dates.format(parseLocalDateOnly(key)!);
  const today = last7[0].dayKey;
  const describe = (day: InsightDay) => day.minutes !== null ? formatDuration(day.minutes, lang)
    : day.dayKey > today ? t("sleepInsights.future") : t("sleepInsights.missing");
  const caption = (day: InsightDay) => label(day.dayKey) + ": " + describe(day);

  return <>
    <section className="sleep-insights-card">
      <h2>{t("sleepInsights.last7")}</h2>
      <p>{t("sleepInsights.recorded")}</p>
      <ul className="sleep-insights-days">
        {last7.map((day, index) => <li key={day.dayKey}>
          <span>{index === 0 ? t("common.today") : index === 1 ? t("common.yesterday") : label(day.dayKey)}</span>
          <span className="sleep-insights-track" aria-hidden="true">
            {day.minutes !== null && <span style={{ width: (day.minutes / scaleMinutes * 100) + "%" }} />}
          </span>
          {day.minutes === null ? <span><span aria-hidden="true">&mdash;</span><span className="insights-visually-hidden">{describe(day)}</span></span>
            : <strong>{describe(day)}</strong>}
        </li>)}
      </ul>
    </section>

    <section className="sleep-insights-card">
      <h2>{t("sleepInsights.last30")}</h2>
      <div className="sleep-insights-scale" aria-hidden="true">{formatDuration(scaleMinutes, lang)}</div>
      <Trend days={last30} scale={scaleMinutes} />
      <div className="sleep-insights-axis" aria-hidden="true"><span>{label(last30[0].dayKey)}</span><span>{t("common.today")}</span></div>
      <ul className="insights-visually-hidden">{last30.map(day => <li key={day.dayKey}>{caption(day)}</li>)}</ul>
    </section>

    <section className="sleep-insights-card">
      <h2>{t("sleepInsights.last15")}</h2>
      <ol className="sleep-insights-weeks">
        {weeks.map((week, index) => <li key={week[0].dayKey}>
          <h3>{index === 0 ? t("sleepInsights.thisWeek") : label(week[0].dayKey)}</h3>
          <div className="sleep-insights-mini" aria-hidden="true">
            {week.map(day => <span key={day.dayKey} data-missing={day.minutes === null}
              style={{ height: ((day.minutes ?? 0) / scaleMinutes * 100) + "%" }} />)}
          </div>
          <ul className="insights-visually-hidden">{week.map(day => <li key={day.dayKey}>{caption(day)}</li>)}</ul>
        </li>)}
      </ol>
    </section>
  </>;
}

function Trend({ days, scale }: { days: InsightDay[]; scale: number }) {
  const points = days.map(({ minutes }, index) => minutes === null ? null
    : { x: 5 + index * 290 / (days.length - 1), y: 95 - minutes / scale * 85 });
  return <svg className="sleep-insights-trend" viewBox="0 0 300 100" aria-hidden="true">
    <path className="sleep-insights-gridline" d="M5 10h290M5 52.5h290M5 95h290" />
    {points.map((point, index) => {
      if (!point) return null;
      const previous = points[index - 1];
      return <g key={days[index].dayKey}>
        {previous && <path d={"M" + previous.x + " " + previous.y + "L" + point.x + " " + point.y} />}
        <circle cx={point.x} cy={point.y} r="2.5" />
      </g>;
    })}
  </svg>;
}
