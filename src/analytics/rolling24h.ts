import { median } from "./time";
import { resolveSleepType } from "./sleepType";
import { computeWakeWindows } from "./wakeWindows";
import type { ActiveSleep, SleepSession } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Rolling24hStats = {
  totalSleepMinutes: number;
  napCount: number;
  medianWakeWindowMinutes: number | null;
};

// Metrics for the rolling last 24 hours ending at `now`. Sessions that cross
// the window boundary are clipped to their overlapping portion only — a
// 3-hour nap that started 1 hour before the window opened contributes 2
// hours, not 3. The currently-active sleep (if any) is included, clipped to
// `now`, since it genuinely is sleep that happened in the window.
export function computeRolling24hStats(
  sessions: SleepSession[],
  active: ActiveSleep | null,
  now: number
): Rolling24hStats {
  const windowStart = now - DAY_MS;

  let totalSleepMinutes = 0;
  let napCount = 0;

  for (const s of sessions) {
    const overlapStart = Math.max(s.startMs, windowStart);
    const overlapEnd = Math.min(s.endMs, now);
    if (overlapEnd <= overlapStart) continue;

    totalSleepMinutes += (overlapEnd - overlapStart) / 60000;

    if (resolveSleepType(s) === "nap") napCount++;
  }

  if (active && active.startMs < now) {
    const overlapStart = Math.max(active.startMs, windowStart);
    const overlapEnd = now;

    if (overlapEnd > overlapStart) {
      totalSleepMinutes += (overlapEnd - overlapStart) / 60000;

      if (resolveSleepType({ sleepTypeRaw: "", startMs: active.startMs }) === "nap") {
        napCount++;
      }
    }
  }

  // Wake windows are gaps BETWEEN sessions, so they're computed from the
  // full (unclipped) session list — a window's validity depends on the
  // sessions bracketing it, not on whether those sessions themselves fall
  // inside the last 24h. Only windows whose gap actually started within the
  // last 24h count toward "today's" median.
  const allWindows = computeWakeWindows(sessions).windows;
  const windowsStartingInPeriod = allWindows.filter(
    (w) => w.startTs >= windowStart && w.startTs <= now
  );

  const medianWakeWindowMinutes = windowsStartingInPeriod.length
    ? median(windowsStartingInPeriod.map((w) => w.minutes))
    : null;

  return {
    totalSleepMinutes: Math.round(totalSleepMinutes),
    napCount,
    medianWakeWindowMinutes,
  };
}
