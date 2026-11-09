import { computeSleepClock } from "../../analytics/sleepClock";
import { useId, useState } from "react";
import { formatClock, formatDuration } from "../../lib/format";
import { sleepClockDetails } from "./sleepClockDetails";
import "./SleepClock.css";
import { useTranslation } from "../../i18n";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  active: ActiveSleep | null;
  now: number;
};

const SIZE = 300;
const CENTER = SIZE / 2;
const BEZEL_R = 141;
const FACE_R = 134;
const OUTER_R = 116;
const INNER_R = 88;
const TICK_OUTER_R = 124;
const TICK_INNER_R = 120;
const TICK_LABEL_R = 136;

// Angle measured clockwise from the top (00:00 local time), like a real
// 24-hour clock face.
function polarToCartesian(angleDeg: number, radius: number) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.sin(angleRad),
    y: CENTER - radius * Math.cos(angleRad),
  };
}

// Builds the arc commands for one edge of a ring segment, chunked into
// <=170deg steps so no single SVG arc command has to handle an ambiguous or
// unsupported >=180deg sweep (segments can legitimately span the full
// circle, e.g. "no recorded sleep at all in the last 24h").
function arcCommands(radius: number, fromAngle: number, toAngle: number, sweep: 0 | 1): string {
  const span = toAngle - fromAngle;
  const steps = Math.max(1, Math.ceil(Math.abs(span) / 170));
  const stepSpan = span / steps;

  const commands: string[] = [];
  for (let i = 1; i <= steps; i++) {
    const angle = fromAngle + i * stepSpan;
    const p = polarToCartesian(angle, radius);
    commands.push(`A ${radius} ${radius} 0 0 ${sweep} ${p.x} ${p.y}`);
  }
  return commands.join(" ");
}

function ringSegmentPath(startAngle: number, endAngle: number): string {
  const outerStart = polarToCartesian(startAngle, OUTER_R);
  const innerEnd = polarToCartesian(endAngle, INNER_R);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    arcCommands(OUTER_R, startAngle, endAngle, 1),
    `L ${innerEnd.x} ${innerEnd.y}`,
    arcCommands(INNER_R, endAngle, startAngle, 0),
    "Z",
  ].join(" ");
}

const LABEL_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

export default function SleepClock({ sessions, active, now }: Props) {
  const { t, lang } = useTranslation();
  const [selectedKey, setSelectedKey] = useState("");
  const detailId = useId();
  const clock = computeSleepClock(sessions, active, now);
  const details = sleepClockDetails(sessions, active, now);
  const selected = details.find(detail => detail.key === selectedKey);
  const current = details.find(detail => detail.isActive);
  const noRecordedMinutes = Math.max(0, 24 * 60 - clock.totalSleepMinutes);
  const range = (detail: typeof details[number]) =>
    `${formatClock(detail.startMs, lang)}–${detail.isActive ? t("history.sleepClockNow") : formatClock(detail.endMs, lang)}`;
  const duration = (detail: typeof details[number]) => detail.isActive
    ? t("history.sleepClockSleepingFor", { duration: formatDuration(detail.durationMinutes, lang) })
    : formatDuration(detail.durationMinutes, lang);
  const dateRange = (detail: typeof details[number]) => {
    const format = (ms: number) => new Intl.DateTimeFormat(lang === "no" ? "nb-NO" : "en-GB", {
      day: "numeric", month: "short",
    }).format(ms);
    return new Date(detail.startMs).toDateString() === new Date(detail.endMs).toDateString()
      ? format(detail.startMs) : `${format(detail.startMs)} – ${format(detail.endMs)}`;
  };
  const label = (detail: typeof details[number]) => `${dateRange(detail)}, ${range(detail)}, ${duration(detail)}`;
  const geometry = (detail: typeof details[number]) => ringSegmentPath(
    clock.nowAngle + (detail.visibleStartMs - (now - 86400000)) / 86400000 * 360,
    clock.nowAngle + (detail.visibleEndMs - (now - 86400000)) / 86400000 * 360,
  );

  return (
    <div className="sleep-clock sleep-clock--summary">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="sleep-clock-svg" role="group" aria-label={t("history.sleepClockTitle")}>
        <circle cx={CENTER} cy={CENTER} r={BEZEL_R} className="sleep-clock-bezel" />
        <circle cx={CENTER} cy={CENTER} r={FACE_R} className="sleep-clock-face" />

        {clock.segments.map((segment, i) => (
          <path
            key={i}
            d={ringSegmentPath(segment.startAngle, segment.endAngle)}
            className={segment.isSleep ? "sleep-clock-segment sleep" : "sleep-clock-segment"}
          />
        ))}

        {LABEL_HOURS.map((hour) => {
          const angle = (hour / 24) * 360;
          const tickStart = polarToCartesian(angle, TICK_INNER_R);
          const tickEnd = polarToCartesian(angle, TICK_OUTER_R);
          const label = polarToCartesian(angle, TICK_LABEL_R);

          return (
            <g key={hour}>
              <line
                x1={tickStart.x}
                y1={tickStart.y}
                x2={tickEnd.x}
                y2={tickEnd.y}
                className="sleep-clock-tick major"
              />
                <text x={label.x} y={label.y} className="sleep-clock-tick-label">
                  {String(hour).padStart(2, "0")}
                </text>
            </g>
          );
        })}

        {details.map(detail => (
          <path key={detail.key} d={geometry(detail)}
            className={`sleep-clock-session${detail.isActive ? " is-active" : ""}${selected?.key === detail.key ? " is-selected" : ""}`}
            role="button" tabIndex={0} aria-label={label(detail)}
            aria-pressed={selected?.key === detail.key} aria-controls={detailId}
            onClick={() => setSelectedKey(detail.key)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedKey(detail.key); }
              if (event.key === "Escape") setSelectedKey("");
            }}
          />
        ))}

        <text x={CENTER} y={CENTER - 12} textAnchor="middle" className="sleep-clock-center-value">
          {formatDuration(clock.totalSleepMinutes, lang)}
        </text>
        <text x={CENTER} y={CENTER + 10} textAnchor="middle" className="sleep-clock-center-pct">
          {t("history.sleepClockSleepTotal")}
        </text>
        <text x={CENTER} y={CENTER + 34} textAnchor="middle" className="sleep-clock-center-pct">
          {t(details.length === 1 ? "history.sleepClockSession" : "history.sleepClockSessions", { count: details.length })}
        </text>
        {current && <text x={CENTER} y={CENTER + 57} textAnchor="middle" className="sleep-clock-active-label">
          {t("history.sleepClockSleepingNow")}
        </text>}
      </svg>
      <div className="sleep-clock-remainder">
        <span>{t("history.sleepClockAwakeTotal")}</span>
        <strong>{formatDuration(noRecordedMinutes, lang)}</strong>
      </div>
      {details.length > 0 && <label className="sleep-clock-picker">
        <span>{t("history.sleepClockChooseSession")}</span>
        <select value={selected?.key ?? ""} onChange={event => setSelectedKey(event.target.value)} aria-controls={detailId}>
          <option value="">{t("history.sleepClockTapHint")}</option>
          {details.map(detail => <option key={detail.key} value={detail.key}>{label(detail)}</option>)}
        </select>
      </label>}
      <div id={detailId} className="sleep-clock-detail" role="status" aria-live="polite" aria-atomic="true">
        {selected ? <>
          <span className="sleep-clock-detail-date">{dateRange(selected)}</span>
          <strong>{range(selected)}</strong>
          <span>{duration(selected)}</span>
        </> : <p>{t(details.length ? "history.sleepClockTapHint" : "history.sleepClockEmpty")}</p>}
      </div>
    </div>
  );
}
