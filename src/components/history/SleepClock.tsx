import { computeSleepClock } from "../../analytics/sleepClock";
import { formatDuration } from "../../lib/format";
import { useTranslation } from "../../i18n";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  active: ActiveSleep | null;
  now: number;
};

const SIZE = 220;
const CENTER = SIZE / 2;
const OUTER_R = 92;
const INNER_R = 62;
const TICK_INNER_R = 94;
const TICK_OUTER_R = 101;
const TICK_LABEL_R = 114;
const NOW_MARKER_R = (OUTER_R + INNER_R) / 2;

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

const HOUR_TICKS = [0, 6, 12, 18];

export default function SleepClock({ sessions, active, now }: Props) {
  const { t, lang } = useTranslation();

  const clock = computeSleepClock(sessions, active, now);
  const nowMarker = polarToCartesian(clock.nowAngle, NOW_MARKER_R);

  return (
    <div className="sleep-clock">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="sleep-clock-svg" role="img" aria-label={t("history.sleepClockTitle")}>
        {clock.segments.map((segment, i) => (
          <path
            key={i}
            d={ringSegmentPath(segment.startAngle, segment.endAngle)}
            className={segment.isSleep ? "sleep-clock-segment sleep" : "sleep-clock-segment"}
          />
        ))}

        {HOUR_TICKS.map((hour) => {
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
                className="sleep-clock-tick"
              />
              <text x={label.x} y={label.y} className="sleep-clock-tick-label">
                {String(hour).padStart(2, "0")}
              </text>
            </g>
          );
        })}

        <circle cx={nowMarker.x} cy={nowMarker.y} r={5} className="sleep-clock-now-dot" />

        <text x={CENTER} y={CENTER - 6} textAnchor="middle" className="sleep-clock-center-value">
          {formatDuration(clock.totalSleepMinutes, lang)}
        </text>

        <text x={CENTER} y={CENTER + 14} textAnchor="middle" className="sleep-clock-center-pct">
          {t("history.sleepClockPercentOfDay", { pct: clock.sleepPct })}
        </text>
      </svg>

      <div className="sleep-clock-legend">
        <span>
          <i className="sleep-clock-legend-dot sleep" />
          {t("home.sleepStripSleep")}
        </span>

        <span>
          <i className="sleep-clock-legend-dot" />
          {t("home.sleepStripNoRecordedSleep")}
        </span>

        <span>
          <i className="sleep-clock-legend-dot now" />
          {t("common.now")}
        </span>
      </div>
    </div>
  );
}
