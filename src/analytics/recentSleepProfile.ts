import { classifyRecentSleep } from "./recentSleepClassification";
import { cleanPersonalSleepSessions, confidenceForHistoryDays, MAX_PLAUSIBLE_SESSION_MINUTES } from "./sleepEvidence";
import type { PersonalSleepProfile } from "./personalSleepProfile";
import { completedLocalDays, recencyWeightAt, usableCompletedDays } from "./sleepHistory";
import { dayKeyOf, minutesSinceLocalMidnight, startOfLocalDay } from "./time";
import { resolveSleepType } from "./sleepType";
import { computeWakeWindows, type WakeWindow } from "./wakeWindows";
import { weightedClockMedian, weightedMedian, weightedPercentile, type WeightedValue } from "./weightedStats";
import type { ActiveSleep, SleepSession } from "./types";

// Session estimates need a completed observation, not a complete day's logging.
// Keep the boundary-overlapping previous night for clipped daily totals, but
// assign each session-level observation to its START local day exactly once.
export function recentSleepEvidence(sessions: SleepSession[], now: number, active: ActiveSleep | null = null, ageDays: number | null = null) {
  const today = startOfLocalDay(now);
  const oldest = completedLocalDays(now).at(-1)?.startMs ?? today;
  const cleaned = cleanPersonalSleepSessions(sessions.filter(s => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) &&
    s.endMs > s.startMs && s.endMs <= now && s.endMs > oldest && s.startMs < today &&
    (s.endMs - s.startMs) / 60000 <= MAX_PLAUSIBLE_SESSION_MINUTES));
  const days = usableCompletedDays(cleaned, now, active, ageDays);
  const dayKeys = new Set(days.map(d => d.localDate));
  const observations = cleaned.filter(s => s.endMs <= today && recencyWeightAt(s.startMs, now, ageDays) > 0);
  // Gaps are only candidate observed wake windows; a logging hole is never
  // treated as awake. Require a usable anchor day and bracketing valid sleeps.
  const wake = computeWakeWindows(cleaned.filter(s => s.endMs <= today));
  const windows = wake.windows.filter(w => dayKeys.has(w.dayKey) && recencyWeightAt(w.startTs, now, ageDays) > 0);
  return { cleaned, observations, days, windows, excludedGapCount: wake.excludedGapCount };
}
export function weightedWakeMedian(windows: WakeWindow[], now: number, ageDays: number | null = null): number | null {
  return weightedMedian(windows.map(w => ({ value: w.minutes, weight: recencyWeightAt(w.startTs, now, ageDays) })));
}
export function recentNightTimings(sessions: SleepSession[], now: number, ageDays: number | null = null) {
  const nights = new Map<string, SleepSession[]>();
  for (const s of sessions.filter(s => resolveSleepType(s) === "night")) {
    const anchor = new Date(s.startMs);
    if (anchor.getHours() < 12) anchor.setDate(anchor.getDate() - 1);
    anchor.setHours(12, 0, 0, 0);
    const key = dayKeyOf(anchor.getTime());
    nights.set(key, [...(nights.get(key) ?? []), s]);
  }
  return [...nights.values()].flatMap(group => {
    const sorted = [...group].sort((a, b) => a.startMs - b.startMs);
    // Main sleep episode, with adjacent night fragments at most 3h apart.
    // This prevents an isolated evening doze becoming the typical bedtime.
    const main = sorted.reduce((a, b) => a.durationMin >= b.durationMin ? a : b);
    let left = sorted.indexOf(main), right = left;
    while (left > 0 && sorted[left].startMs - sorted[left - 1].endMs <= 180 * 60000) left--;
    while (right + 1 < sorted.length && sorted[right + 1].startMs - sorted[right].endMs <= 180 * 60000) right++;
    const weight = recencyWeightAt(sorted[left].startMs, now, ageDays);
    return weight ? [{ bedtime: minutesSinceLocalMidnight(sorted[left].startMs), wake: minutesSinceLocalMidnight(sorted[right].endMs), weight }] : [];
  });
}
export type RecentSleepProfile = Omit<PersonalSleepProfile, "averageTotalSleepPerDay" | "averageNapCountPerDay"> & {
  typicalTotalSleepPerDay: number | null;
  typicalNapCountPerDay: number | null;
  usableDayCount: number;
  napDurationRange: [number, number] | null;
  wakeWindowRange: [number, number] | null;
  typicalLongestStretch: number | null;
  atNightPct: number | null;
};
export function computePersonalSleepProfile(sessions: SleepSession[], now: number, active: ActiveSleep | null = null, ageDays: number | null = null): RecentSleepProfile {
  const evidence = recentSleepEvidence(sessions, now, active, ageDays);
  const { observations, days, windows } = evidence;
  const sample = (s: SleepSession): WeightedValue => ({ value: s.durationMin, weight: recencyWeightAt(s.startMs, now, ageDays) });
  const classified = classifyRecentSleep(observations, now, ageDays);
  const typeById = new Map(classified.map(s => [s.id, resolveSleepType(s)]));
  const naps = classified.filter(s => resolveSleepType(s) === "nap").map(sample);
  const nights = classified.filter(s => resolveSleepType(s) === "night").map(sample);
  const timings = recentNightTimings(classified, now, ageDays);
  const range = (values: WeightedValue[]): [number, number] | null => {
    const low = weightedPercentile(values, 0.25), high = weightedPercentile(values, 0.75);
    return low == null || high == null ? null : [low, high];
  };
  const daily = days.map(day => {
    const total = day.fragments.reduce((sum, f) => sum + (f.endMs - f.startMs) / 60000, 0);
    // Use clipped minutes for shares; count nap starts, never every sleep.
    const night = evidence.cleaned.filter(s => (typeById.get(s.id) ?? resolveSleepType(s)) === "night")
      .reduce((sum, s) => sum + Math.max(0, Math.min(s.endMs, day.endMs) - Math.max(s.startMs, day.startMs)) / 60000, 0);
    const starts = classified.filter(s => dayKeyOf(s.startMs) === day.localDate);
    return { weight: day.weight, total, nightShare: night / total * 100,
      naps: starts.filter(s => resolveSleepType(s) === "nap").length,
      longest: starts.length ? Math.max(...starts.map(s => s.durationMin)) : null };
  });
  const dailyMedian = (field: "total" | "naps" | "nightShare") => weightedMedian(daily.map(d => ({ value: d[field], weight: d.weight })));
  const bucket = (from: number, to: number) => {
    const selected = windows.filter(w => { const h = new Date(w.startTs).getHours(); return h >= from && h < to; });
    return selected.length >= 2 ? weightedWakeMedian(selected, now, ageDays) : null;
  };
  const historyDays = new Set(observations.map(s => dayKeyOf(s.startMs))).size;
  return {
    historyDays, completedSessionCount: observations.length, usableDayCount: days.length,
    // One raw daily observation and one recency factor per eligible day.
    typicalTotalSleepPerDay: dailyMedian("total"), typicalNapCountPerDay: dailyMedian("naps"),
    medianNapDuration: weightedMedian(naps), medianNightSleepDuration: weightedMedian(nights),
    medianWakeWindow: weightedWakeMedian(windows, now, ageDays), morningWakeWindow: bucket(0, 12),
    middayWakeWindow: bucket(12, 17), eveningWakeWindow: bucket(17, 24),
    typicalBedtime: timings.length >= 2 ? weightedClockMedian(timings.map(t => ({ value: t.bedtime, weight: t.weight }))) : null,
    typicalWakeTime: timings.length >= 2 ? weightedClockMedian(timings.map(t => ({ value: t.wake, weight: t.weight }))) : null,
    confidence: confidenceForHistoryDays(days.length), napDurationRange: range(naps),
    wakeWindowRange: range(windows.map(w => ({ value: w.minutes, weight: recencyWeightAt(w.startTs, now, ageDays) }))),
    typicalLongestStretch: weightedMedian(daily.flatMap(d => d.longest == null ? [] : [{ value: d.longest, weight: d.weight }])),
    atNightPct: dailyMedian("nightShare"),
  };
}

// Fields shown by the Personal Sleep Profile card.
export function hasDisplayableSleepProfile(profile: RecentSleepProfile): boolean {
  return [profile.typicalTotalSleepPerDay, profile.typicalNapCountPerDay,
    profile.medianWakeWindow, profile.typicalBedtime, profile.typicalWakeTime].some(value => value != null);
}
