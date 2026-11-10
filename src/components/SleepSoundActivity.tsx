import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import type { SleepRecord } from "../services/sleepService";
import { getSoundEventsForSleep, type SoundEvent } from "../services/soundEventService";
import { soundActivityTimeline } from "../sound/activityTimeline";
import "./SleepSoundActivity.css";

type CompletedSleep = Pick<SleepRecord, "id" | "baby_id" | "starttime" | "endtime">;

// Kept separate from fetching so loading/errors never block the sleep form.
export function SoundActivityTimeline({ sleep, events }: { sleep: CompletedSleep; events: SoundEvent[] }) {
  const { t, locale } = useTranslation();
  const id = useId(), track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [selected, setSelected] = useState<string | null>(null);
  const [listLimit, setListLimit] = useState(20);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const resize = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const timeline = soundActivityTimeline(sleep, events, width);
  const choice = timeline.items.find(item => item.event.id === selected);
  const clock = (time: number, seconds = false) => new Date(time).toLocaleTimeString(locale, {
    hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}),
  });
  const date = (time: number) => new Date(time).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const duration = (ms: number) => {
    const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
    return seconds < 1 ? t("soundActivity.underSecond") : minutes
      ? t("soundActivity.minutesSeconds", { minutes, seconds: seconds % 60 })
      : t("soundActivity.seconds", { seconds });
  };
  const label = (item: typeof timeline.items[number]) => t("soundActivity.eventLabel", {
    start: `${date(item.from)} ${clock(item.from, true)}`, end: `${date(item.to)} ${clock(item.to, true)}`,
    duration: duration(item.durationMs), intensity: t(`soundActivity.${item.intensity}`),
  });
  const select = (eventId: string) => {
    setSelected(eventId);
    requestAnimationFrame(() => document.getElementById(`${id}-detail`)?.scrollIntoView({ block: "nearest" }));
  };
  return <>
    {!timeline.valid ? <p className="sound-activity-note">{t("soundActivity.invalid")}</p> : <>
      <p className="sound-activity-summary">{timeline.items.length
        ? t(timeline.items.length === 1 ? "soundActivity.summaryOne" : "soundActivity.summary", { count: timeline.items.length, duration: duration(timeline.totalMs) })
        : t("soundActivity.empty")}</p>
      <div className="sound-activity-plot" ref={track}>
        <div className="sound-activity-scroll" tabIndex={timeline.lanes > 3 ? 0 : undefined}
          role="group" aria-label={t("soundActivity.timeline")}>
          <div className="sound-activity-lanes" style={{ height: Math.max(64, timeline.lanes * 44) }}>
            {timeline.markers.map(marker => <span key={marker.fraction} className="sound-activity-guide"
              aria-hidden="true" style={{ left: `${marker.fraction * 100}%` }} />)}
            {timeline.items.map(item => <button type="button" key={item.event.id}
              className={`sound-activity-event ${item.intensity}`}
              style={{ left: `${item.hitLeft}%`, width: `${item.hitWidth}%`, top: item.lane * 44 }}
              aria-label={label(item)} aria-pressed={selected === item.event.id} aria-controls={`${id}-detail`}
              onClick={() => select(item.event.id)}>
              <span aria-hidden="true" style={{ left: `${(item.left - item.hitLeft) / item.hitWidth * 100}%`, width: `${item.width / item.hitWidth * 100}%` }} />
            </button>)}
          </div>
        </div>
        <div className="sound-activity-scale" aria-hidden="true">
          {timeline.markers.map(marker => <span key={marker.fraction} style={{ left: `${marker.fraction * 100}%` }}>
            {clock(marker.time, timeline.span < 120000)}
          </span>)}
        </div>
        <div className="sound-activity-boundaries">
          <span>{t("soundActivity.sleepStart")}<strong>{clock(timeline.start, timeline.span < 120000)}</strong><small>{date(timeline.start)}</small></span>
          <span>{t("soundActivity.sleepEnd")}<strong>{clock(timeline.end, timeline.span < 120000)}</strong><small>{date(timeline.end)}</small></span>
        </div>
      </div>
      <div id={`${id}-detail`} className="sound-activity-detail" role="status" aria-live="polite">
        {choice ? <>
          <strong>{date(choice.from)} · {clock(choice.from, true)}–{clock(choice.to, true)}{date(choice.from) !== date(choice.to) && ` · ${date(choice.to)}`}</strong>
          <span>{t("soundActivity.detectedFor", { duration: duration(choice.durationMs) })}</span>
          <span>{t(`soundActivity.${choice.intensity}Activity`)}</span>
          {(choice.from !== choice.displayStart || choice.to !== choice.displayEnd) && <small>{t("soundActivity.clipped", { duration: duration(choice.visibleDurationMs) })}</small>}
        </> : timeline.items.length > 0 && <span>{t("soundActivity.tapEvent")}</span>}
      </div>
      {timeline.items.length > 0 && <details className="sound-activity-list">
        <summary>{t("soundActivity.viewEvents", { count: timeline.items.length })}</summary>
        <ol>{timeline.items.slice(0, listLimit).map(item => <li key={item.event.id}>
          <button type="button" onClick={() => select(item.event.id)} aria-label={label(item)}
            aria-pressed={selected === item.event.id} aria-controls={`${id}-detail`}>
            <span>{clock(item.from, true)}<small>{duration(item.durationMs)}</small></span>
            <span>{t(`soundActivity.${item.intensity}`)}</span>
          </button>
        </li>)}</ol>
        {listLimit < timeline.items.length && <button type="button" className="secondary-button" onClick={() => setListLimit(value => value + 20)}>{t("soundActivity.showMore")}</button>}
      </details>}
    </>}
    <p className="sound-activity-note">{t("soundActivity.observationsOnly")}</p>
  </>;
}

export default function SleepSoundActivity({ sleep }: { sleep: CompletedSleep }) {
  const { t } = useTranslation();
  const id = useId();
  const [result, setResult] = useState<{ status: "loading" | "ready" | "error"; events: SoundEvent[] }>({ status: "loading", events: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getSoundEventsForSleep(sleep.id).then(events => {
      if (!cancelled) setResult({ status: "ready", events });
    }).catch(() => { if (!cancelled) setResult({ status: "error", events: [] }); });
    return () => { cancelled = true; };
  }, [sleep.id, attempt]);
  return <section className="sleep-sound-activity" aria-labelledby={id} aria-busy={result.status === "loading"}>
    <h3 id={id}>{t("soundActivity.title")}</h3>
    {result.status === "loading" && <p role="status" className="sound-activity-note">{t("soundActivity.loading")}</p>}
    {result.status === "error" && <div role="status"><p>{t("soundActivity.error")}</p>
      <button type="button" className="secondary-button" onClick={() => { setResult({ status: "loading", events: [] }); setAttempt(value => value + 1); }}>{t("common.retry")}</button>
    </div>}
    {result.status === "ready" && <SoundActivityTimeline sleep={sleep} events={result.events} />}
  </section>;
}
