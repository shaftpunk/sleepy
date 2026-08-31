import { circularMeanTimeOfDay, dayKeyOf, lastNLocalDayKeys, median, minutesSinceLocalMidnight } from "./time";
import { resolveSleepType } from "./sleepType";
import { computeWakeWindows } from "./wakeWindows";
import type { SleepSession } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type WindowAverage = {
  avgMinutes: number | null;
  daysWithData: number;
};

// Mean of daily totals across the `days` local calendar days ending at
// `referenceNow`, counting only days that had recorded sleep.
export function computeWindowAverage(
  sessions: SleepSession[],
  referenceNow: number,
  days: number
): WindowAverage {
  const keys = new Set(lastNLocalDayKeys(referenceNow, days));
  const totals = new Map<string, number>();

  for (const s of sessions) {
    const key = dayKeyOf(s.startMs);
    if (!keys.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + s.durationMin);
  }

  const daysWithData = totals.size;
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);

  return {
    avgMinutes: daysWithData ? sum / daysWithData : null,
    daysWithData,
  };
}

export type WeeklyTrend =
  | { direction: "insufficient-history" }
  | { direction: "same" | "more" | "less"; diffMinutes: number };

export function computeWeeklyTrend(
  sessions: SleepSession[],
  now: number
): WeeklyTrend {
  const current = computeWindowAverage(sessions, now, 7);
  const previous = computeWindowAverage(sessions, now - 7 * DAY_MS, 7);

  if (current.avgMinutes == null || previous.avgMinutes == null) {
    return { direction: "insufficient-history" };
  }

  const diffMinutes = current.avgMinutes - previous.avgMinutes;

  if (Math.abs(diffMinutes) < 10) return { direction: "same", diffMinutes };

  return { direction: diffMinutes > 0 ? "more" : "less", diffMinutes };
}

export type OverviewKpis = {
  longestMinutes: number;
  atNightPct: number | null;
  napsPerDay: number | null;
};

export function computeKpis(sessions: SleepSession[], now: number): OverviewKpis {
  const longestMinutes = sessions.reduce((max, s) => Math.max(max, s.durationMin), 0);

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  const nightMinutes = sessions
    .filter((s) => resolveSleepType(s) === "night")
    .reduce((sum, s) => sum + s.durationMin, 0);

  const atNightPct = totalMinutes > 0 ? (nightMinutes / totalMinutes) * 100 : null;

  const last7Keys = new Set(lastNLocalDayKeys(now, 7));
  const last7Sessions = sessions.filter((s) => last7Keys.has(dayKeyOf(s.startMs)));
  const daysWithData = new Set(last7Sessions.map((s) => dayKeyOf(s.startMs))).size;

  const napsPerDay = daysWithData > 0 ? last7Sessions.length / daysWithData : null;

  return { longestMinutes, atNightPct, napsPerDay };
}

export type RhythmCard = {
  bedtimeMin: number | null;
  wakeMin: number | null;
  medianWakeWindowMinutes: number | null;
};

export function computeRhythmCard(sessions: SleepSession[]): RhythmCard {
  const nightSessions = sessions.filter((s) => resolveSleepType(s) === "night");

  const bedtimeMin =
    nightSessions.length >= 2
      ? circularMeanTimeOfDay(nightSessions.map((s) => minutesSinceLocalMidnight(s.startMs)))
      : null;

  const wakeMin =
    nightSessions.length >= 2
      ? circularMeanTimeOfDay(nightSessions.map((s) => minutesSinceLocalMidnight(s.endMs)))
      : null;

  const windows = computeWakeWindows(sessions).windows;
  const medianWakeWindowMinutes = windows.length
    ? median(windows.map((w) => w.minutes))
    : null;

  return { bedtimeMin, wakeMin, medianWakeWindowMinutes };
}
