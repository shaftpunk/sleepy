import { dayKeyOf } from "./time";

type Interval = { startMs: number; endMs: number };
export function sequenceContext(intervals: Interval[]) {
  let date = "", count = 0, minutes = 0;
  return intervals.map(interval => {
    const day = dayKeyOf(interval.endMs);
    if (day !== date) { date = day; count = 0; minutes = 0; }
    const duration = (interval.endMs - interval.startMs) / 60000;
    return { count: ++count, minutes: minutes += duration, duration };
  });
}

// Product similarity scales; research-informed but not clinically validated.
const SEQUENCE_SCALE = { sleepCount: 3, accumulatedMinutes: 360, logDurationRatio: 0.5 };

type Context = ReturnType<typeof sequenceContext>[number];
export function sequenceSimilarity(current: Context, historical: Context): number {
  return Math.exp(-Math.abs(current.count - historical.count) / SEQUENCE_SCALE.sleepCount
    - Math.abs(current.minutes - historical.minutes) / SEQUENCE_SCALE.accumulatedMinutes
    - Math.abs(Math.log(Math.max(1, current.duration) / Math.max(1, historical.duration))) / SEQUENCE_SCALE.logDurationRatio);
}
