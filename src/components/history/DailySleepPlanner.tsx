import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { buildDailyPlannerModel, type PlannerDay, type PlannerEvent } from "../../analytics/dailyPlannerModel";
import type { DailySleepForecast, UpcomingDayForecast } from "../../analytics/dailySleepForecast";
import type { NextSleepPrediction } from "../../analytics/nextSleep";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock, formatDuration } from "../../lib/format";
import "./DailySleepPlanner.css";

/** Pixels per minute: one linear scale, so equal durations get equal height. */
export const PLANNER_PX_PER_MINUTE = 1.1;
const LABEL_HEIGHT = 36;

type Props = {
  sessions: SleepSession[]; active: ActiveSleep | null; prediction: NextSleepPrediction;
  forecast: DailySleepForecast | null; upcoming: UpcomingDayForecast | null; now: number;
  /** Recorded sessions that can be opened for editing. */
  editableIds?: ReadonlySet<string>;
  onSelectSession?: (id: string) => void;
  /** Changes when the calendar should scroll back to now (e.g. baby switch). */
  resetKey?: string | null;
};

export default function DailySleepPlanner({ sessions, active, prediction, forecast, upcoming, now, editableIds, onSelectSession, resetKey }: Props) {
  const { t, lang } = useTranslation();
  const titleId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildDailyPlannerModel({ sessions, active, prediction, forecast, upcoming, now }),
    [sessions, active, prediction, forecast, upcoming, now]);
  const weekdayDate = new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", day: "numeric", month: "short" });
  const dateFormat = { format: (ms: number) => { const text = weekdayDate.format(ms); return text.charAt(0).toLocaleUpperCase(LOCALES[lang]) + text.slice(1); } };
  const shortDate = new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" });
  const clock = (ms: number) => formatClock(ms, lang);
  const range = (startMs: number, endMs: number) => `${clock(startMs)}–${clock(endMs)}`;
  const px = (minutes: number) => minutes * PLANNER_PX_PER_MINUTE;
  const first = model.days[0];

  // Open at now (about a third down), on first render and when the baby or
  // day changes; afterwards the parent's own scrolling is left alone.
  const scrollKey = `${resetKey ?? ""}|${first?.key ?? ""}`;
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || scrolledFor.current === scrollKey || !first) return;
    scrolledFor.current = scrollKey;
    if (first.now !== null) element.scrollTop = Math.max(0, px(first.now) - element.clientHeight * .32);
  });

  const describe = (e: PlannerEvent) => {
    const sleep = e.sleep ? t("history.planEstimatedSleep", { duration: formatDuration((e.sleep.endMs - e.sleep.startMs) / 60000, lang) }) : null;
    switch (e.kind) {
      case "recorded": return [range(e.startMs, e.endMs), [e.clippedStart ? t("history.planStartedOn", { date: shortDate.format(e.startMs) }) : t("history.planRecorded"),
        formatDuration((e.endMs - e.startMs) / 60000, lang)].join(" · ")];
      case "active": return [`${clock(e.startMs)}–`, [t("history.planSleepingNow"), formatDuration((e.endMs - e.startMs) / 60000, lang)].join(" · ")];
      case "next": return [range(e.startMs, e.endMs), [t("history.planNextOnset"), sleep].filter(Boolean).join(" · ")];
      case "later": return [range(e.startMs, e.endMs), [t("history.planLaterNap"), sleep].filter(Boolean).join(" · ")];
      case "wake": return [range(e.startMs, e.endMs), t("history.planWake")];
    }
  };

  const renderDay = (day: PlannerDay) => {
    // Labels sit at the top of their block; a label that would collide with
    // the one above in the same lane moves down. Blocks never move.
    const laneBottoms = new Map<string, number>();
    const labelTops = new Map<string, number>();
    for (const e of day.events) {
      const lane = `${e.lane}/${e.lanes}`;
      const top = Math.max(px(e.top) + 5, (laneBottoms.get(lane) ?? -Infinity) + 2);
      labelTops.set(e.key, top);
      laneBottoms.set(lane, top + LABEL_HEIGHT);
    }
    const height = px(day.minutes);
    return <div className="sleep-planner-day" data-planner-day={day.mode} style={{ height }}>
      {day.hours.map(h => <div key={h.instant} className="sleep-planner-hour" style={{ top: px(h.top) }} aria-hidden="true">
        {(day.now === null || Math.abs(h.top - day.now) >= 14) && <span>{clock(h.instant)}</span>}
      </div>)}
      <div className="sleep-planner-events">
        {day.awake.filter(a => px(a.height) >= 30).map(a => <p key={a.key} className="sleep-planner-awake" style={{ top: px(a.top), height: px(a.height) }}>
          <span>{a.untilNow ? t("history.planAwakeSince", { time: clock(a.startMs) }) : t("history.planAwake", { duration: formatDuration((a.endMs - a.startMs) / 60000, lang) })}</span>
        </p>)}
      </div>
      <div className="sleep-planner-events is-list" role="list">
        {day.events.map(e => {
          const [time, detail] = describe(e);
          const left = `calc(${(e.lane / e.lanes) * 100}% + ${e.lane ? 3 : 0}px)`, width = `calc(${100 / e.lanes}% - ${e.lanes > 1 ? 3 : 0}px)`;
          const windowHeight = px(((Math.min(e.endMs, day.frameEndMs) - Math.max(e.startMs, day.frameStartMs)) / 60000));
          const editable = Boolean(e.sessionId && onSelectSession && editableIds?.has(e.sessionId));
          const classes = `sleep-planner-event is-${e.kind}${e.clippedStart ? " is-clipped-start" : ""}${e.clippedEnd ? " is-clipped-end" : ""}${e.sleep ? " has-sleep" : ""}${e.sequenceIndex && e.kind === "later" ? ` is-depth-${Math.min(3, e.sequenceIndex)}` : ""}`;
          const body = <>
            {(e.kind === "next" || e.kind === "later" || e.kind === "wake")
              ? <span className="sleep-planner-window" style={{ height: windowHeight }} />
              : <span className="sleep-planner-block" style={{ height: Math.max(2, px(e.height)) }} />}
            {e.sleep && <span className="sleep-planner-sleep" style={{ top: px((e.sleep.startMs - e.startMs) / 60000), height: px((e.sleep.endMs - e.sleep.startMs) / 60000) }} />}
          </>;
          const label = <span className="sleep-planner-label" style={{ top: (labelTops.get(e.key) ?? 0) - px(e.top) }}>
            <strong>{time}</strong><small>{detail}</small>
          </span>;
          return <div key={e.key} role="listitem" className={classes} data-planner-event={e.kind}
            style={{ top: px(e.top), height: Math.max(2, px(e.height)), left, width }}>
            {editable
              ? <button type="button" className="sleep-planner-hit" onClick={() => onSelectSession!(e.sessionId!)}>{body}{label}</button>
              : <div className="sleep-planner-hit">{body}{label}</div>}
          </div>;
        })}
      </div>
      {day.now !== null && <div className="sleep-planner-now" style={{ top: px(day.now) }} aria-hidden="true"><span>{clock(now)}</span></div>}
    </div>;
  };

  const predicted = model.days.flatMap(d => d.events).filter(e => e.kind !== "recorded" && e.kind !== "active");
  const today = first?.mode === "today" && !first.preliminary;
  return <section className="sleep-planner" aria-labelledby={titleId} data-planner-status={model.status} data-planner-night={model.night}>
    <header className="sleep-planner-header">
      <div>
        <h2 id={titleId}>{today ? t("history.planTitle") : t("history.planUpcomingTitle")}</h2>
        {first && <p>{dateFormat.format(first.dayStartMs)}</p>}
      </div>
      <span className="sleep-planner-chip">{today ? t("common.today") : t("history.planPreliminary")}</span>
    </header>
    {first?.preliminary && <p className="sleep-planner-note">{first.noForecast ? t("sleepWave.upcomingLearning") : t("sleepWave.preliminary")}</p>}
    {today && !first.events.some(e => e.kind === "recorded" || e.kind === "active") && <p className="sleep-planner-note">{t("history.planEmpty")}</p>}
    {today && first.noForecast && !model.night && <p className="sleep-planner-note">{t("history.planNoForecast")}</p>}
    <div ref={scroller} className="sleep-planner-scroll" role="region" aria-label={t("history.planCalendarLabel")} tabIndex={0}>
      {model.days.map((day, i) => <div key={day.key}>
        {i > 0 && <div className="sleep-planner-divider">
          <strong>{t("history.planUpcomingTitle")}</strong>
          <span>{dateFormat.format(day.dayStartMs)} · {t("history.planPreliminary")}</span>
          <small>{day.noForecast ? t("sleepWave.upcomingLearning") : t("sleepWave.preliminary")}</small>
        </div>}
        {renderDay(day)}
      </div>)}
    </div>
    <div className="sleep-planner-legend" aria-hidden="true">
      <span><i className="is-recorded" />{t("history.planRecorded")}</span>
      {model.days.some(d => d.events.some(e => e.kind === "active")) && <span><i className="is-active" />{t("history.planSleepingNow")}</span>}
      {predicted.some(e => e.kind === "next") && <span><i className="is-next" />{t("history.planNextOnset")}</span>}
      {predicted.some(e => e.kind === "later") && <span><i className="is-later" />{t("history.planLaterNap")}</span>}
      {predicted.some(e => e.kind === "wake") && <span><i className="is-wake" />{t("history.planWake")}</span>}
      {predicted.some(e => e.sleep) && <span><i className="is-sleep" />{t("sleepWave.estimatedSleep")}</span>}
    </div>
    {predicted.length > 0 && <p className="sleep-planner-footnote">{t("history.planNote")}</p>}
  </section>;
}
