import { recentSleepEvidence } from "./recentSleepProfile";
import type { BucketDistribution } from "./buckets";
import type { ActiveSleep, SleepSession } from "./types";
// Minute-aligned local wall-clock histogram. Iterating real minutes handles both
// occurrences of a fall-back hour and skips nonexistent spring-forward time.
// Only usable completed days contribute; each clipped minute receives its day's
// recency factor once. These are histogram masses, never recorded sleep totals.
export function recentBucketDistribution(sessions: SleepSession[], now: number, active: ActiveSleep | null = null, ageDays: number | null = null): BucketDistribution {
  const buckets = Array<number>(8).fill(0);
  for (const day of recentSleepEvidence(sessions, now, active, ageDays).days) for (const f of day.fragments) {
    let cursor = f.startMs;
    while (cursor < f.endMs) {
      const end = Math.min(f.endMs, (Math.floor(cursor / 60000) + 1) * 60000);
      buckets[Math.floor(new Date(cursor).getHours() / 3)] += (end - cursor) / 60000 * day.weight;
      cursor = end;
    }
  }
  return { bucketMinutes: buckets, totalMinutes: buckets.reduce((a, b) => a + b, 0),
    busiestIndex: buckets.indexOf(Math.max(...buckets)) };
}
