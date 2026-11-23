import { dayKeyOf, lastNLocalDayKeys, splitMinutesByLocalDay } from "./time";
import type { BucketDistribution } from "./buckets";
import { recentSleepEvidence, weightedWakeMedian } from "./recentSleepProfile";
import { recentBucketDistribution } from "./recentPatterns";
import { type WakeWindowGroup } from "./wakeWindows";
import type { ActiveSleep, SleepSession } from "./types";

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
    // A session's minutes are split across every calendar day it actually
    // spans (so an overnight sleep counts toward both days' totals), but
    // sessionCount is a discrete "sleep started this day" tally that stays
    // on the start day only - it doesn't make sense to split a single event
    // in two.
    for (const frag of splitMinutesByLocalDay(s.startMs, s.endMs)) {
      const bucket = byDay.get(frag.dayKey);
      if (!bucket) continue;
      bucket.totalMinutes += frag.minutes;
    }

    const startBucket = byDay.get(dayKeyOf(s.startMs));
    if (startBucket) startBucket.sessionCount += 1;
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
  now: number,
  active: ActiveSleep | null = null,
  ageDays: number | null = null
): BucketDistribution {
  return recentBucketDistribution(sessions, now, active, ageDays);
}

export type WakeWindowsThroughDay = {
  groups: WakeWindowGroup[];
  excludedGapCount: number;
};

export function computeWakeWindowsThroughDay(sessions: SleepSession[], now: number, active: ActiveSleep | null = null, ageDays: number | null = null): WakeWindowsThroughDay {
  const result = recentSleepEvidence(sessions, now, active, ageDays);
  return {
    groups: (["1st", "2nd", "3rd", "4th+"] as const).map((label, i) => {
      const selected = result.windows.filter(w => Math.min(w.index, 3) === i);
      return { label, count: selected.length, medianMinutes: weightedWakeMedian(selected, now, ageDays) };
    }),
    excludedGapCount: result.excludedGapCount,
  };
}
