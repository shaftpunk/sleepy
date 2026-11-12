import { useId, useMemo } from "react";
import { buildSleepProbabilityBuckets, buildSleepTimelineRows, SLEEP_TIMELINE_STEP_MINUTES, timelinePositionToTime } from "../../analytics/sleepTimeline";
import { minutesToClockLabel } from "../../analytics/time";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { useTranslation } from "../../i18n";

type Props = { sessions: SleepSession[]; active: ActiveSleep | null; now: number;
  selectedTime: string; onSelectTime: (time: string) => void };
const position = (startMinute: number, endMinute: number) => ({ left: `${startMinute / 14.4}%`, width: `${(endMinute - startMinute) / 14.4}%` });
export default function SleepRhythmTimeline({ sessions, active, now, selectedTime, onSelectTime }: Props) {
  const { t, locale } = useTranslation();
  const id = useId();
  const rows = useMemo(() => buildSleepTimelineRows(sessions, now), [sessions, now]);
  const buckets = useMemo(() => buildSleepProbabilityBuckets(sessions, now, active), [sessions, now, active]);
  const pattern = buckets.filter(bucket => bucket.band !== "none");
  const [hour, minute] = selectedTime.split(":").map(Number);
  const selectedMinute = hour * 60 + minute;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const fullDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  return <div className="sleep-rhythm" role="group" aria-labelledby={id + "-title"} aria-describedby={id + "-help"}>
    <h3 id={id + "-title"}>{t("sleepTimeline.title")}</h3>
    <p className="muted" id={id + "-help"}>{t("sleepTimeline.interaction")}</p>
    <div className="sleep-rhythm-axis" aria-hidden="true">
      <span />
      <div>{[0, 6, 12, 18, 24].map(h => <span key={h} style={{ left: `${h / 24 * 100}%` }}>{String(h).padStart(2, "0")}</span>)}</div>
    </div>
    {rows.map(row => <div key={row.day} className="sleep-rhythm-row">
      <span className="sleep-rhythm-day" aria-hidden="true">{weekday.format(row.startMs)}{row.clockChanges.length > 0 ? "*" : ""}</span>
      <button type="button" className="sleep-rhythm-track" data-day={row.day}
        aria-label={t("sleepTimeline.row", { day: fullDate.format(row.startMs), count: row.recordedSessions })}
        aria-describedby={id + "-help " + id + "-" + row.day}
        onClick={event => {
          if (event.detail === 0) { onSelectTime(selectedTime); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          const time = timelinePositionToTime(event.clientX, rect.left, rect.width);
          if (time) onSelectTime(time);
        }}
        onKeyDown={event => {
          let next: number;
          if (event.key === "ArrowRight") next = selectedMinute + SLEEP_TIMELINE_STEP_MINUTES;
          else if (event.key === "ArrowLeft") next = selectedMinute - SLEEP_TIMELINE_STEP_MINUTES;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = 1440 - SLEEP_TIMELINE_STEP_MINUTES;
          else return;
          event.preventDefault(); onSelectTime(minutesToClockLabel(next));
        }}>
        {pattern.map(bucket => <span key={bucket.startMinute} aria-hidden="true" className={`sleep-rhythm-pattern ${bucket.band}`} style={position(bucket.startMinute, bucket.endMinute)} />)}
        {row.clockChanges.map((change, i) => <span key={`clock-${i}`} aria-hidden="true" className="sleep-rhythm-clock-change" style={position(change.startMinute, change.endMinute)} />)}
        {row.segments.map((segment, i) => <span key={i} aria-hidden="true" className="sleep-rhythm-recorded" style={position(segment.startMinute, segment.endMinute)} />)}
        <span aria-hidden="true" className="sleep-rhythm-selected" style={{ left: `${selectedMinute / 14.4}%` }} />
      </button>
      <span className="sleep-rhythm-sr" id={id + "-" + row.day}>{row.segments.length
        ? row.segments.map(segment => `${minutesToClockLabel(segment.startMinute)}–${segment.endMinute === 1440 ? "24:00" : minutesToClockLabel(segment.endMinute)}`).join(", ")
        : t("sleepTimeline.noRecordedSleep")}{row.clockChanges.length ? `. ${t("sleepTimeline.dst")}` : ""}</span>
    </div>)}
    <div className="sleep-rhythm-legend">
      <span><i className="sleep-rhythm-recorded-key" aria-hidden="true" />{t("sleepTimeline.recorded")}</span>
      <span><i className="sleep-rhythm-pattern-key" aria-hidden="true" />{t("sleepTimeline.pattern")}</span>
    </div>
    <p className="muted">{t("sleepTimeline.emptyExplanation")}</p>
    <p className="muted">{t("sleepTimeline.patternExplanation")}</p>
    {pattern.length === 0 && <p className="muted">{t("sleepTimeline.noPattern")}</p>}
    {rows.some(row => row.clockChanges.length > 0) && <p className="muted">* {t("sleepTimeline.dst")}</p>}
  </div>;
}
