import { computeSleepStrip } from "./home";
import { minutesSinceLocalMidnight } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

const CLOCK_WINDOW_HOURS = 24;

export type SleepClockSegment = {
  // Degrees, clockwise from 00:00 local time at the top (like a real
  // 24-hour clock face) — 0deg/90deg/180deg/270deg are always 00/06/12/18,
  // regardless of what time it is right now. Continuous/unwrapped (may
  // exceed 360), which lets segments straddle the midnight crossing inside
  // the rolling window without special-casing: sin/cos are periodic, so
  // converting an unwrapped angle straight to screen coordinates already
  // wraps correctly.
  startAngle: number;
  endAngle: number;
  isSleep: boolean;
};

export type SleepClockData = {
  segments: SleepClockSegment[];
  // Angle of the current moment - always the same position as the seam
  // where the rolling window starts/ends, since 24h ago has the same
  // time-of-day as now.
  nowAngle: number;
  totalSleepMinutes: number;
  sleepPct: number;
};

// A 24-hour "clock face" view of the rolling last 24 hours: unlike the
// Home screen's linear 12h strip (oldest-to-newest, left-to-right), this
// anchors each 10-minute cell to its actual wall-clock time-of-day so the
// ring reads like a real clock (sleep around 2pm always lands at the "2
// o'clock" position) while still always showing a full, current rolling day.
export function computeSleepClock(
  sessions: SleepSession[],
  active: ActiveSleep | null,
  now: number
): SleepClockData {
  const cells = computeSleepStrip(sessions, active, now, CLOCK_WINDOW_HOURS);

  const baseAngle = (minutesSinceLocalMidnight(now) / 1440) * 360;
  const cellAngle = 360 / cells.length;

  const segments: SleepClockSegment[] = [];
  let totalSleepMinutes = 0;

  cells.forEach((cell, i) => {
    const startAngle = baseAngle + i * cellAngle;
    const endAngle = startAngle + cellAngle;

    if (cell.isSleep) totalSleepMinutes += (cell.endMs - cell.startMs) / 60000;

    const last = segments[segments.length - 1];
    if (last && last.isSleep === cell.isSleep) {
      last.endAngle = endAngle;
    } else {
      segments.push({ startAngle, endAngle, isSleep: cell.isSleep });
    }
  });

  const totalWindowMinutes = CLOCK_WINDOW_HOURS * 60;

  return {
    segments,
    nowAngle: baseAngle,
    totalSleepMinutes: Math.round(totalSleepMinutes),
    sleepPct: Math.round((totalSleepMinutes / totalWindowMinutes) * 100),
  };
}
