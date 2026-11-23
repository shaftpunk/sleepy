import { normalizeSleepRows } from "./normalize";
import { dayKeyOf, lastNLocalDayKeys, splitMinutesByLocalDay, startOfLocalDay } from "./time";
import type { RawSleepRow } from "./types";

export type InsightSleepRow = RawSleepRow & { baby_id: string; deleted_at?: string | null };
export type InsightDay = { dayKey: string; minutes: number | null };

export function sleepInsightsWindow(now: number) {
  const today = new Date(startOfLocalDay(now));
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const first = new Date(today);
  first.setDate(first.getDate() - daysSinceMonday - 14 * 7);
  return { startMs: first.getTime(), daysSinceMonday };
}

export function buildSleepInsights(rows: InsightSleepRow[], babyId: string, now: number) {
  const { startMs, daysSinceMonday } = sleepInsightsWindow(now);
  const { sessions, active } = normalizeSleepRows(rows.filter(row => row.baby_id === babyId && !row.deleted_at));
  const intervals = sessions.map(({ startMs: start, endMs: end }) => ({
    start: Math.max(startMs, start), end: Math.min(now, end),
  }));
  if (active) intervals.push({ start: Math.max(startOfLocalDay(now), active.startMs), end: now });

  // Count each sleeping minute once when overlapping records describe the same period.
  const merged: typeof intervals = [];
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    if (interval.start >= interval.end) continue;
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push(interval);
  }

  const totals = new Map<string, number>();
  for (const interval of merged) {
    for (const { dayKey, minutes } of splitMinutesByLocalDay(interval.start, interval.end)) {
      totals.set(dayKey, (totals.get(dayKey) ?? 0) + minutes);
    }
  }

  // Sleep records show how much sleep was logged. An empty day has no evidence
  // of recording coverage, so leave it unknown even when adjacent days are full.
  const day = (dayKey: string): InsightDay => ({ dayKey, minutes: totals.get(dayKey) ?? null });
  const historical = lastNLocalDayKeys(now, 14 * 7 + daysSinceMonday + 1);
  const weekKeys = [...historical];
  const future = new Date(startOfLocalDay(now));
  for (let i = daysSinceMonday; i < 6; i++) {
    future.setDate(future.getDate() + 1);
    weekKeys.push(dayKeyOf(future.getTime()));
  }
  const weeks = Array.from({ length: 15 }, (_, index) => {
    const start = (14 - index) * 7;
    return weekKeys.slice(start, start + 7).map(day);
  });
  const scaleMinutes = Math.max(60, Math.ceil(Math.max(0, ...totals.values()) / 60) * 60);
  return {
    last7: historical.slice(-7).reverse().map(day),
    last30: historical.slice(-30).map(day),
    weeks,
    scaleMinutes,
  };
}
