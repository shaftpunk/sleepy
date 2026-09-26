import { computeSleepClock } from "../../analytics/sleepClock";
import { formatDuration } from "../../lib/format";
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
const TICK_OUTER_R = 130;
const MAJOR_TICK_INNER_R = 121;
const MINOR_TICK_INNER_R = 125;
const TICK_LABEL_R = 74;

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

const HOUR_TICKS = Array.from({ length: 24 }, (_, hour) => hour);
const LABEL_HOURS = new Set([0, 3, 6, 9, 12, 15, 18, 21]);

function handEnd(angleDeg: number, length: number) {
  return polarToCartesian(angleDeg, length);
}

export default function SleepClock({ sessions, active, now }: Props) {
  const { t, lang } = useTranslation();

  const clock = computeSleepClock(sessions, active, now);
  const localNow = new Date(now);
  const minuteAngle = (localNow.getMinutes() / 60) * 360;
  const hourHand = handEnd(clock.nowAngle, 66);
  const minuteHand = handEnd(minuteAngle, 82);
  const noRecordedMinutes = Math.max(0, 24 * 60 - clock.totalSleepMinutes);

  return (
    <div className="sleep-clock">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="sleep-clock-svg" role="img" aria-label={t("history.sleepClockTitle")}>
        <circle cx={CENTER} cy={CENTER} r={BEZEL_R} className="sleep-clock-bezel" />
        <circle cx={CENTER} cy={CENTER} r={FACE_R} className="sleep-clock-face" />

        {clock.segments.map((segment, i) => (
          <path
            key={i}
            d={ringSegmentPath(segment.startAngle, segment.endAngle)}
            className={segment.isSleep ? "sleep-clock-segment sleep" : "sleep-clock-segment"}
          />
        ))}

        {HOUR_TICKS.map((hour) => {
          const angle = (hour / 24) * 360;
          const major = hour % 3 === 0;
          const tickStart = polarToCartesian(
            angle,
            major ? MAJOR_TICK_INNER_R : MINOR_TICK_INNER_R,
          );
          const tickEnd = polarToCartesian(angle, TICK_OUTER_R);
          const label = polarToCartesian(angle, TICK_LABEL_R);

          return (
            <g key={hour}>
              <line
                x1={tickStart.x}
                y1={tickStart.y}
                x2={tickEnd.x}
                y2={tickEnd.y}
                className={major ? "sleep-clock-tick major" : "sleep-clock-tick"}
              />
              {LABEL_HOURS.has(hour) && (
                <text x={label.x} y={label.y} className="sleep-clock-tick-label">
                  {String(hour).padStart(2, "0")}
                </text>
              )}
            </g>
          );
        })}

        <line
          x1={CENTER}
          y1={CENTER}
          x2={hourHand.x}
          y2={hourHand.y}
          className="sleep-clock-hand hour"
        />
        <line
          x1={CENTER}
          y1={CENTER}
          x2={minuteHand.x}
          y2={minuteHand.y}
          className="sleep-clock-hand minute"
        />
        <circle cx={CENTER} cy={CENTER} r={6} className="sleep-clock-hand-pin" />

        <text x={CENTER} y={CENTER + 38} textAnchor="middle" className="sleep-clock-center-value">
          {formatDuration(clock.totalSleepMinutes, lang)}
        </text>

        <text x={CENTER} y={CENTER + 54} textAnchor="middle" className="sleep-clock-center-pct">
          {t("history.sleepClockPercentOfDay", { pct: clock.sleepPct })}
        </text>
      </svg>

      <div className="sleep-clock-totals">
        <div>
          <span><i className="sleep-clock-legend-dot sleep" />{t("history.sleepClockSleepTotal")}</span>
          <strong>{formatDuration(clock.totalSleepMinutes, lang)}</strong>
        </div>
        <div>
          <span><i className="sleep-clock-legend-dot" />{t("history.sleepClockAwakeTotal")}</span>
          <strong>{formatDuration(noRecordedMinutes, lang)}</strong>
        </div>
      </div>

      <div className="sleep-clock-legend">
        <span>
          <i className="sleep-clock-legend-dot sleep" />
          {t("home.sleepStripSleep")}
        </span>

        <span>
          <i className="sleep-clock-legend-dot" />
          {t("home.sleepStripNoRecordedSleep")}
        </span>

      </div>
    </div>
  );
}
