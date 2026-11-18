import { dayKeyOf, startOfLocalDay } from "./time";
import { MAX_PLAUSIBLE_SESSION_MINUTES } from "./sleepEvidence";
import type { ActiveSleep, SleepSession } from "./types";

export const RECENT_PATTERN_DAYS = 30;
// Coverage is a clipped >=12h first-to-last observation span, with at least two
// disjoint intervals as a safeguard against one forgotten registration. It is a
// logging proxy, not proof that intervening gaps were awake or fully observed.
export const USABLE_DAY_RULE = { minimumIntervals: 2, minimumSpanHours: 12 } as const;
export function getRecencyWeight(daysAgo: number): number {
  if (!Number.isInteger(daysAgo) || daysAgo < 1 || daysAgo > RECENT_PATTERN_DAYS) return 0;
  return daysAgo <= 7 ? 1 : daysAgo <= 14 ? 0.75 : daysAgo <= 21 ? 0.5 : 0.25;
}
export function completedLocalDays(now: number, count = RECENT_PATTERN_DAYS) {
  if (!Number.isFinite(now)) return [];
  return Array.from({ length: Math.max(0, Math.min(RECENT_PATTERN_DAYS, Math.floor(count))) }, (_, i) => {
    const date = new Date(startOfLocalDay(now));
    date.setDate(date.getDate() - i - 1);
    const startMs = startOfLocalDay(date.getTime());
    date.setDate(date.getDate() + 1);
    return { localDate: dayKeyOf(startMs), startMs, endMs: startOfLocalDay(date.getTime()), daysAgo: i + 1, weight: getRecencyWeight(i + 1) };
  });
}
export function recencyWeightAt(timestamp: number, now: number): number {
  return completedLocalDays(now).find(d => timestamp >= d.startMs && timestamp < d.endMs)?.weight ?? 0;
}
type Interval = { startMs: number; endMs: number };
// Input is the existing normalizeSleepRows output. Use the existing plausibility
// limit, but union overlaps here: a duplicated/split registration must not inflate
// coverage, day counts or weights. Do not change the personalized classifier's
// separate first-seen overlap policy or use its nap/night labels for this feature.
export function recordedIntervals(sessions: SleepSession[], now: number): Interval[] {
  const valid = sessions.filter(s => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) &&
    s.endMs > s.startMs && s.endMs <= now && s.durationMin > 0 &&
    s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES &&
    (s.endMs - s.startMs) / 60000 <= MAX_PLAUSIBLE_SESSION_MINUTES)
    .map(s => ({ startMs: s.startMs, endMs: s.endMs })).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const intervals: Interval[] = [];
  for (const interval of valid) {
    const previous = intervals[intervals.length - 1];
    if (previous && interval.startMs <= previous.endMs) previous.endMs = Math.max(previous.endMs, interval.endMs);
    else intervals.push(interval);
  }
  return intervals;
}

// Same conservative span/interval proxy as Probability, without its selected-instant
// test. This is evidence of logging, never proof that every gap was awake.
export function usableCompletedDays(sessions: SleepSession[], now: number, active: ActiveSleep | null = null) {
  const intervals = recordedIntervals(sessions, now);
  return completedLocalDays(now).flatMap(day => {
    if (active && active.startMs < day.endMs && active.startMs <= now) return [];
    const fragments = intervals.filter(s => s.startMs < day.endMs && s.endMs > day.startMs)
      .map(s => ({ startMs: Math.max(day.startMs, s.startMs), endMs: Math.min(day.endMs, s.endMs) }));
    if (fragments.length < USABLE_DAY_RULE.minimumIntervals ||
        fragments[fragments.length - 1].endMs - fragments[0].startMs < USABLE_DAY_RULE.minimumSpanHours * 3600000) return [];
    return [{ ...day, fragments }];
  });
}
