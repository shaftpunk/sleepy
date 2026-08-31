import type { SleepSession } from "./types";

export const BUCKET_COUNT = 8;
export const DEFAULT_BUCKET_WINDOW_DAYS = 30;

export type BucketDistribution = {
  bucketMinutes: number[]; // length 8, index i = hours [3i, 3i+3)
  totalMinutes: number;
  busiestIndex: number;
};

// DST is deliberately not special-cased here (per spec): during a
// spring-forward transition one chunk may span 2 real hours instead of 1
// (harmless — still bucketed by the start hour), and during a fall-back
// transition the repeated wall-clock hour can attribute ~60 minutes to the
// wrong bucket in one of its two passes. Accepted, documented failure mode.
function distributeIntoBuckets(
  startMs: number,
  endMs: number,
  buckets: number[]
): void {
  let cursor = startMs;

  while (cursor < endMs) {
    const cursorDate = new Date(cursor);
    const hour = cursorDate.getHours();
    const bucketIdx = Math.floor(hour / 3);

    const nextHourBoundary = new Date(cursorDate);
    nextHourBoundary.setMinutes(0, 0, 0);
    nextHourBoundary.setHours(cursorDate.getHours() + 1);

    const chunkEndMs = Math.min(nextHourBoundary.getTime(), endMs);
    const minutes = (chunkEndMs - cursor) / 60000;

    buckets[bucketIdx] += minutes;
    cursor = chunkEndMs;
  }
}

export function computeBucketDistribution(
  sessions: SleepSession[],
  windowStartMs: number,
  windowEndMs: number
): BucketDistribution {
  const buckets = new Array(BUCKET_COUNT).fill(0);

  for (const s of sessions) {
    const clippedStart = Math.max(s.startMs, windowStartMs);
    const clippedEnd = Math.min(s.endMs, windowEndMs);

    if (clippedEnd <= clippedStart) continue;

    distributeIntoBuckets(clippedStart, clippedEnd, buckets);
  }

  const totalMinutes = buckets.reduce((a, b) => a + b, 0);

  let busiestIndex = 0;
  for (let i = 1; i < BUCKET_COUNT; i++) {
    if (buckets[i] > buckets[busiestIndex]) busiestIndex = i;
  }

  return { bucketMinutes: buckets, totalMinutes, busiestIndex };
}
