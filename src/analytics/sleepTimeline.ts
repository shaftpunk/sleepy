import { calculateSleepProbability } from "./sleepProbability";
import { dayKeyOf, minutesSinceLocalMidnight, minutesToClockLabel, startOfLocalDay } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

export const SLEEP_TIMELINE_STEP_MINUTES = 15;
export const SLEEP_PATTERN_THRESHOLDS = { weak: 40, moderate: 60, strong: 80 } as const;
export type PatternBand = "none" | "weak" | "moderate" | "strong";
export type SleepTimelineSegment = { startMinute: number; endMinute: number };
export type SleepTimelineRow = {
  day: string; startMs: number; segments: SleepTimelineSegment[]; recordedSessions: number;
  clockChanges: (SleepTimelineSegment & { kind: "missing" | "repeated" })[];
};
export function sleepPatternBand(percentage: number | null): PatternBand {
  if (percentage === null || !Number.isFinite(percentage) || percentage < SLEEP_PATTERN_THRESHOLDS.weak) return "none";
  if (percentage >= SLEEP_PATTERN_THRESHOLDS.strong) return "strong";
  return percentage >= SLEEP_PATTERN_THRESHOLDS.moderate ? "moderate" : "weak";
}
export function buildSleepProbabilityBuckets(sessions: SleepSession[], now: number, active: ActiveSleep | null = null) {
  return Array.from({ length: 1440 / SLEEP_TIMELINE_STEP_MINUTES }, (_, index) => {
    const startMinute = index * SLEEP_TIMELINE_STEP_MINUTES;
    // One shared engine, including its usable-day rules and DST abstentions.
    // The sample is at the bucket's labelled start, not a second interval formula.
    const result = calculateSleepProbability(sessions, minutesToClockLabel(startMinute), now, active);
    return { startMinute, endMinute: startMinute + SLEEP_TIMELINE_STEP_MINUTES,
      percentage: result.weightedPercentage, band: sleepPatternBand(result.weightedPercentage) };
  });
}
export function timelinePositionToTime(clientX: number, left: number, width: number): string | null {
  if (![clientX, left, width].every(Number.isFinite) || width <= 0) return null;
  const minute = Math.round(Math.max(0, Math.min(1, (clientX - left) / width)) * 1440 / SLEEP_TIMELINE_STEP_MINUTES) * SLEEP_TIMELINE_STEP_MINUTES;
  return minutesToClockLabel(Math.min(1440 - SLEEP_TIMELINE_STEP_MINUTES, minute));
}

// Locate actual UTC-offset boundaries inside a local day. Splitting there avoids
// drawing a spring-forward gap as sleep or giving a fall-back segment negative
// width on a fixed 00–24 local-clock axis. Calendar midnights bound every row.
function offsetTransitions(start: number, end: number): number[] {
  const transitions: number[] = [];
  let cursor = start;
  while (cursor < end - 1) {
    const next = Math.min(end - 1, cursor + 30 * 60000);
    if (new Date(cursor).getTimezoneOffset() !== new Date(next).getTimezoneOffset()) {
      let low = cursor, high = next;
      const offset = new Date(cursor).getTimezoneOffset();
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (new Date(middle).getTimezoneOffset() === offset) low = middle;
        else high = middle;
      }
      transitions.push(high);
    }
    cursor = next;
  }
  return transitions;
}
const clockMinute = (instant: number) => minutesSinceLocalMidnight(instant) + new Date(instant).getMilliseconds() / 60000;
const minuteBefore = (instant: number) => Math.round((clockMinute(instant - 1) + 1 / 60000) * 1000000) / 1000000;
export function buildSleepTimelineRows(sessions: SleepSession[], now: number): SleepTimelineRow[] {
  if (!Number.isFinite(now)) return [];
  const today = startOfLocalDay(now);
  const rows: SleepTimelineRow[] = [];
  for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
    const date = new Date(today); date.setDate(date.getDate() - daysAgo);
    const start = startOfLocalDay(date.getTime()); date.setDate(date.getDate() + 1);
    const end = startOfLocalDay(date.getTime());
    const transitions = offsetTransitions(start, end);
    const clockChanges = transitions.map(instant => {
      const before = minuteBefore(instant), after = minutesSinceLocalMidnight(instant);
      return { startMinute: Math.min(before, after), endMinute: Math.max(before, after),
        kind: after > before ? "missing" as const : "repeated" as const };
    });
    const segments: SleepTimelineSegment[] = [], registrations = new Set<string>();
    for (const session of sessions) {
      // Actual recorded history: do not apply the prediction's 12h plausibility
      // cutoff or show an open/unfinished session as a completed observation.
      if (!Number.isFinite(session.startMs) || !Number.isFinite(session.endMs) || session.endMs <= session.startMs ||
        session.endMs > now || session.startMs >= end || session.endMs <= start) continue;
      const key = `${session.startMs}:${session.endMs}`;
      if (registrations.has(key)) continue;
      registrations.add(key);
      const from = Math.max(start, session.startMs), to = Math.min(end, session.endMs);
      const cuts = [from, ...transitions.filter(t => t > from && t < to), to];
      for (let i = 0; i < cuts.length - 1; i++) {
        const startMinute = clockMinute(cuts[i]);
        const endMinute = cuts[i + 1] === end ? 1440 : minuteBefore(cuts[i + 1]);
        if (endMinute > startMinute) segments.push({ startMinute, endMinute });
      }
    }
    rows.push({ day: dayKeyOf(start), startMs: start, segments, recordedSessions: registrations.size, clockChanges });
  }
  return rows;
}
