import { parseLocalDateOnly } from "./localDate";
import { dayKeyOf, startOfLocalDay } from "./time";
import { MAX_PLAUSIBLE_SESSION_MINUTES } from "./personalSleepProfile";
import type { ActiveSleep, SleepSession } from "./types";

export const SLEEP_PROBABILITY_LOOKBACK_DAYS = 30;
export const MIN_SLEEP_PROBABILITY_DAYS = 5;
// Coverage comes from the clipped first-to-last observation span (>=12h),
// with the selected instant inside it. Two disjoint intervals are only a
// secondary safeguard against one long/forgotten registration; episode count
// is not a completeness signal and must not penalize consolidated sleepers.
// This remains a logging proxy, not proof that intervening gaps were awake.
export const USABLE_DAY_RULE = { minimumIntervals: 2, minimumSpanHours: 12 } as const;
type Interval = { startMs: number; endMs: number };
export type SleepProbability = {
  selectedTime: string; sleepingDays: number; usableDays: number;
  rawPercentage: number | null; weightedPercentage: number | null;
  weightedSleep: number; weightedTotal: number; insufficientData: boolean;
};
export function getRecencyWeight(daysAgo: number): number {
  if (!Number.isInteger(daysAgo) || daysAgo < 1 || daysAgo > SLEEP_PROBABILITY_LOOKBACK_DAYS) return 0;
  return daysAgo <= 7 ? 1 : daysAgo <= 14 ? 0.75 : daysAgo <= 21 ? 0.5 : 0.25;
}

// Construct local wall time, never an ISO substring or a UTC hour. A missing
// spring-forward time or repeated fall-back time has no single instant: abstain
// for that day instead of silently shifting the time or choosing an occurrence.
export function localClockInstant(localDate: string, selectedTime: string): number | null {
  const date = parseLocalDateOnly(localDate);
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(selectedTime)) return null;
  const [hour, minute] = selectedTime.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  const matches = (value: Date) => dayKeyOf(value.getTime()) === localDate && value.getHours() === hour && value.getMinutes() === minute;
  if (!matches(date)) return null;
  for (const direction of [-1, 1]) {
    const nearbyOffset = new Date(date.getTime() + direction * 86400000).getTimezoneOffset();
    const alternative = date.getTime() + (nearbyOffset - date.getTimezoneOffset()) * 60000;
    if (alternative !== date.getTime() && matches(new Date(alternative))) return null;
  }
  return date.getTime();
}
export function isSleepAtLocalTime(session: Interval, localDate: string, selectedTime: string): boolean {
  const instant = localClockInstant(localDate, selectedTime);
  return instant !== null && session.startMs <= instant && instant < session.endMs;
}

// Input is the existing normalizeSleepRows output. Use the existing plausibility
// limit, but union overlaps here: a duplicated/split registration must not inflate
// coverage, day counts or weights. Do not change the personalized classifier's
// separate first-seen overlap policy or use its nap/night labels for this feature.
function recordedIntervals(sessions: SleepSession[], now: number): Interval[] {
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
export function getUsableHistoricalDays(sessions: SleepSession[], selectedTime: string, now: number, active: ActiveSleep | null = null) {
  if (!Number.isFinite(now)) return [];
  const intervals = recordedIntervals(sessions, now);
  const days: { localDate: string; daysAgo: number; asleep: boolean; weight: number }[] = [];
  const today = startOfLocalDay(now);
  for (let daysAgo = 1; daysAgo <= SLEEP_PROBABILITY_LOOKBACK_DAYS; daysAgo++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const start = startOfLocalDay(date.getTime()), localDate = dayKeyOf(start);
    date.setDate(date.getDate() + 1);
    const end = startOfLocalDay(date.getTime()), instant = localClockInstant(localDate, selectedTime);
    if (instant === null || (active && active.startMs < end && active.startMs <= now)) continue;
    const fragments = intervals.filter(s => s.startMs < end && s.endMs > start)
      .map(s => ({ startMs: Math.max(start, s.startMs), endMs: Math.min(end, s.endMs) }));
    if (fragments.length < USABLE_DAY_RULE.minimumIntervals) continue;
    const first = fragments[0].startMs, last = fragments[fragments.length - 1].endMs;
    if (last - first < USABLE_DAY_RULE.minimumSpanHours * 3600000 || instant < first || instant >= last) continue;
    days.push({ localDate, daysAgo, weight: getRecencyWeight(daysAgo),
      asleep: fragments.some(s => s.startMs <= instant && instant < s.endMs) });
  }
  return days;
}
export function calculateSleepProbability(sessions: SleepSession[], selectedTime: string, now: number, active: ActiveSleep | null = null): SleepProbability {
  const days = getUsableHistoricalDays(sessions, selectedTime, now, active);
  const sleepingDays = days.filter(day => day.asleep).length;
  const weightedTotal = days.reduce((total, day) => total + day.weight, 0);
  const weightedSleep = days.reduce((total, day) => total + (day.asleep ? day.weight : 0), 0);
  const insufficientData = days.length < MIN_SLEEP_PROBABILITY_DAYS;
  return { selectedTime, sleepingDays, usableDays: days.length,
    rawPercentage: days.length ? sleepingDays / days.length * 100 : null,
    weightedPercentage: insufficientData ? null : Math.round(weightedSleep / weightedTotal * 100),
    weightedSleep, weightedTotal, insufficientData };
}
