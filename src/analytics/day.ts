import { dayKeyOf, lastNLocalDayKeys } from "./time";
import { computeBucketDistribution, DEFAULT_BUCKET_WINDOW_DAYS, type BucketDistribution } from "./buckets";
import { computeWakeWindows, groupWakeWindows, type WakeWindowGroup } from "./wakeWindows";
import type { SleepSession } from "./types";

export type DayBar = {
  dayKey: string;
  totalMinutes: number;
  sessionCount: number;
  pctOfMax: number;
};

// Ascending oldest -> today (last 7 local calendar days).
export function computeSleepPerDayLast7(
  sessions: SleepSession[],
  now: number
): DayBar[] {
  const keys = lastNLocalDayKeys(now, 7);

  const byDay = new Map<string, { totalMinutes: number; sessionCount: number }>();
  for (const key of keys) byDay.set(key, { totalMinutes: 0, sessionCount: 0 });

  for (const s of sessions) {
    const key = dayKeyOf(s.startMs);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    bucket.totalMinutes += s.durationMin;
    bucket.sessionCount += 1;
  }

  const maxMinutes = Math.max(1, ...[...byDay.values()].map((d) => d.totalMinutes));

  return keys.map((key) => {
    const bucket = byDay.get(key)!;
    return {
      dayKey: key,
      totalMinutes: bucket.totalMinutes,
      sessionCount: bucket.sessionCount,
      pctOfMax: (bucket.totalMinutes / maxMinutes) * 100,
    };
  });
}

// Shared 30-day window with the Insight tab's "busiest window" insight, so
// both surfaces stay numerically consistent.
export function computeHourlyDistribution(
  sessions: SleepSession[],
  now: number
): BucketDistribution {
  const windowStart = now - DEFAULT_BUCKET_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return computeBucketDistribution(sessions, windowStart, now);
}

export type WakeWindowsThroughDay = {
  groups: WakeWindowGroup[];
  excludedGapCount: number;
};

export function computeWakeWindowsThroughDay(
  sessions: SleepSession[]
): WakeWindowsThroughDay {
  const result = computeWakeWindows(sessions);
  return {
    groups: groupWakeWindows(result.windows),
    excludedGapCount: result.excludedGapCount,
  };
}
