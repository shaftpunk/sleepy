import { parseLocalDateOnly } from "./localDate";
import { dayKeyOf } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

import { RECENT_PATTERN_DAYS, usableCompletedDays } from "./sleepHistory";
export { getRecencyWeight, USABLE_DAY_RULE, recordedIntervals } from "./sleepHistory";
export const SLEEP_PROBABILITY_LOOKBACK_DAYS = RECENT_PATTERN_DAYS;
export const MIN_SLEEP_PROBABILITY_DAYS = 5;
type Interval = { startMs: number; endMs: number };
export type SleepProbability = {
  selectedTime: string; sleepingDays: number; usableDays: number;
  rawPercentage: number | null; weightedPercentage: number | null;
  weightedSleep: number; weightedTotal: number; insufficientData: boolean;
};
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

export function getUsableHistoricalDays(sessions: SleepSession[], selectedTime: string, now: number, active: ActiveSleep | null = null, ageDays: number | null = null) {
  const days: { localDate: string; daysAgo: number; asleep: boolean; weight: number }[] = [];
  for (const day of usableCompletedDays(sessions, now, active, ageDays)) {
    const instant = localClockInstant(day.localDate, selectedTime);
    const first = day.fragments[0].startMs, last = day.fragments[day.fragments.length - 1].endMs;
    // Probability alone needs evidence bracketing the selected wall-clock instant.
    if (instant === null || instant < first || instant >= last) continue;
    days.push({ localDate: day.localDate, daysAgo: day.daysAgo, weight: day.weight,
      asleep: day.fragments.some(s => s.startMs <= instant && instant < s.endMs) });
  }
  return days;
}
export function calculateSleepProbability(sessions: SleepSession[], selectedTime: string, now: number, active: ActiveSleep | null = null, ageDays: number | null = null): SleepProbability {
  const days = getUsableHistoricalDays(sessions, selectedTime, now, active, ageDays);
  const sleepingDays = days.filter(day => day.asleep).length;
  const weightedTotal = days.reduce((total, day) => total + day.weight, 0);
  const weightedSleep = days.reduce((total, day) => total + (day.asleep ? day.weight : 0), 0);
  const insufficientData = days.length < MIN_SLEEP_PROBABILITY_DAYS;
  return { selectedTime, sleepingDays, usableDays: days.length,
    rawPercentage: days.length ? sleepingDays / days.length * 100 : null,
    weightedPercentage: insufficientData ? null : Math.round(weightedSleep / weightedTotal * 100),
    weightedSleep, weightedTotal, insufficientData };
}
