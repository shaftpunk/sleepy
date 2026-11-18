import { dayKeyOf, startOfLocalDay } from "./time";
import { MAX_PLAUSIBLE_SESSION_MINUTES } from "./sleepEvidence";
import type { ActiveSleep, SleepSession } from "./types";

export const RECENT_PATTERN_DAYS = 30;
// Coverage is a clipped >=12h first-to-last observation span, with at least two
// disjoint intervals as a safeguard against one forgotten registration. It is a
// logging proxy, not proof that intervening gaps were awake or fully observed.
export const USABLE_DAY_RULE = { minimumIntervals: 2, minimumSpanHours: 12 } as const;
// Product heuristics, research-informed but not clinically validated.
export const RECENCY_AGE_DECAY_DAYS = 120;
export function ageConservatism(ageDays: number | null = null): number {
  return ageDays === null || !Number.isFinite(ageDays) || ageDays < 0 ? 0 : Math.exp(-ageDays / RECENCY_AGE_DECAY_DAYS);
}
export function getRecencyWeight(daysAgo: number, ageDays: number | null = null): number {
  if (!Number.isInteger(daysAgo) || daysAgo < 1 || daysAgo > RECENT_PATTERN_DAYS) return 0;
  const baseline = daysAgo <= 7 ? 1 : daysAgo <= 14 ? 0.75 : daysAgo <= 21 ? 0.5 : 0.25;
  return baseline ** (1 + ageConservatism(ageDays));
}
export function completedLocalDays(now: number, count = RECENT_PATTERN_DAYS, ageDays: number | null = null) {
  if (!Number.isFinite(now)) return [];
  return Array.from({ length: Math.max(0, Math.min(RECENT_PATTERN_DAYS, Math.floor(count))) }, (_, i) => {
    const date = new Date(startOfLocalDay(now));
    date.setDate(date.getDate() - i - 1);
    const startMs = startOfLocalDay(date.getTime());
    date.setDate(date.getDate() + 1);
    return { localDate: dayKeyOf(startMs), startMs, endMs: startOfLocalDay(date.getTime()), daysAgo: i + 1, weight: getRecencyWeight(i + 1, ageDays) };
  });
}
export function recencyWeightAt(timestamp: number, now: number, ageDays: number | null = null): number {
  return completedLocalDays(now, RECENT_PATTERN_DAYS, ageDays).find(d => timestamp >= d.startMs && timestamp < d.endMs)?.weight ?? 0;
}
type Interval = { startMs: number; endMs: number };
// Input is the existing normalizeSleepRows output. Use the existing plausibility
// limit, but union overlaps here: a duplicated/split registration must not inflate
// coverage, day counts or weights. Do not change the personalized classifier's
// separate first-seen overlap policy or use its nap/night labels for this feature.
export function recordedIntervals(sessions: SleepSession[], now: number): Interval[] {
  const valid = sessions.filter(s => isUsableSleepRecord(s, now))
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
export function usableCompletedDays(sessions: SleepSession[], now: number, active: ActiveSleep | null = null, ageDays: number | null = null) {
  const intervals = recordedIntervals(sessions, now);
  return completedLocalDays(now, RECENT_PATTERN_DAYS, ageDays).flatMap(day => {
    if (active && active.startMs < day.endMs && active.startMs <= now) return [];
    const fragments = intervals.filter(s => s.startMs < day.endMs && s.endMs > day.startMs)
      .map(s => ({ startMs: Math.max(day.startMs, s.startMs), endMs: Math.min(day.endMs, s.endMs) }));
    if (fragments.length < USABLE_DAY_RULE.minimumIntervals ||
        fragments[fragments.length - 1].endMs - fragments[0].startMs < USABLE_DAY_RULE.minimumSpanHours * 3600000) return [];
    return [{ ...day, fragments }];
  });
}

export function isUsableSleepRecord(s: SleepSession, now: number): boolean {
  return Number.isFinite(s.startMs) && Number.isFinite(s.endMs) &&
    s.endMs > s.startMs && s.endMs <= now && s.durationMin > 0 &&
    s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES &&
    (s.endMs - s.startMs) / 60000 <= MAX_PLAUSIBLE_SESSION_MINUTES;
}

// Product heuristic; coverage is evidence of logging, not verified wakefulness.
export const RECORDED_TRANSITION_RULE = {
  neighborhoodHours: 18,
  minimumIntervals: 3,
  maxGapMinutes: 360,
} as const;

export function recordedTransitionCheck(intervals: Interval[], sessions: SleepSession[], now: number) {
  const minute = 60000;
  const maxGap = RECORDED_TRANSITION_RULE.maxGapMinutes * minute;
  const neighborhood = RECORDED_TRANSITION_RULE.neighborhoodHours * 60 * minute;
  const successors = new Map(intervals.slice(0, -1).map((interval, i) =>
    [interval.endMs, intervals[i + 1].startMs]));
  const rejected = sessions.filter(s => !isUsableSleepRecord(s, now));
  return (from: number, to: number): boolean => {
    if (successors.get(from) !== to || to <= from || to - from > maxGap) return false;
    if (rejected.some(s => s.startMs < to && s.endMs > from)) return false;
    const nearby = intervals.filter(s => s.startMs >= from - neighborhood && s.endMs <= to + neighborhood);
    return nearby.length >= RECORDED_TRANSITION_RULE.minimumIntervals &&
      nearby[nearby.length - 1].endMs - nearby[0].startMs >= USABLE_DAY_RULE.minimumSpanHours * 60 * minute &&
      nearby.every((s, i) => i === 0 || s.startMs - nearby[i - 1].endMs <= maxGap);
  };
}
