import { dayKeyOf } from "./time";
import { resolveSleepType } from "./sleepType";
import { computeWeeklyTrend } from "./overview";
import { computePersonalSleepProfile } from "./recentSleepProfile";
import { completedLocalDays } from "./sleepHistory";
import type { ActiveSleep, Insight, SleepSession } from "./types";
import { MAX_PLAUSIBLE_SESSION_MINUTES } from "./sleepEvidence";

// Exact recorded-period evidence; these rows display real counts and minutes.
export function recordedAnalysisPeriod(sessions: SleepSession[], now: number): SleepSession[] {
  const keys = new Set(completedLocalDays(now).map(d => d.localDate));
  return sessions.filter(s => keys.has(dayKeyOf(s.startMs)) && s.endMs <= now && s.endMs > s.startMs && s.durationMin > 0 && s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES);
}

export type QualityDistributionRow = {
  rating: 5 | 4 | 3 | 2 | 1;
  count: number;
  pctOfMax: number;
  sharePct: number;
};

// One row per rating 5->1, bar % relative to the most common rating, detail
// = share of RATED sessions (not all sessions).
export function computeQualityDistribution(sessions: SleepSession[]): QualityDistributionRow[] {
  const rated = sessions.filter((s) => s.rate != null && Number.isFinite(s.rate) && Math.round(s.rate) >= 1 && Math.round(s.rate) <= 5);
  const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

  for (const s of rated) {
    const r = Math.round(s.rate as number);
    if (r >= 1 && r <= 5) counts[r] = (counts[r] ?? 0) + 1;
  }

  const maxCount = Math.max(0, ...Object.values(counts));

  return ([5, 4, 3, 2, 1] as const).map((rating) => ({
    rating,
    count: counts[rating],
    pctOfMax: maxCount ? (counts[rating] / maxCount) * 100 : 0,
    sharePct: rated.length ? (counts[rating] / rated.length) * 100 : 0,
  }));
}

export type NightDaySplitRow = {
  label: "night" | "day";
  totalMinutes: number;
  sessionCount: number;
  sharePct: number;
};

// Uses the same populated-or-inferred SLEEP_TYPE resolution as the KPI.
export function computeNightVsDayBreakdown(sessions: SleepSession[], now: number): NightDaySplitRow[] {
  const days = completedLocalDays(now);
  if (!days.length) return [];
  const start = days[days.length - 1].startMs, end = days[0].endMs;
  const starts = new Set(recordedAnalysisPeriod(sessions, now).map(s => s.id));
  // Clip minutes at both calendar boundaries, including the carry-in night.
  // Session counts remain discrete starts in the selected completed-day period.
  sessions = sessions.filter(s => s.endMs <= now && s.endMs > s.startMs && s.durationMin > 0 && s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES)
    .flatMap(s => {
      const minutes = Math.max(0, Math.min(end, s.endMs) - Math.max(start, s.startMs)) / 60000;
      return minutes > 0 ? [{ ...s, durationMin: minutes }] : [];
    });
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  const night = sessions.filter((s) => resolveSleepType(s) === "night");
  const day = sessions.filter((s) => resolveSleepType(s) === "nap");

  const row = (label: "night" | "day", arr: SleepSession[]): NightDaySplitRow => {
    const minutes = arr.reduce((sum, s) => sum + s.durationMin, 0);
    return {
      label,
      totalMinutes: minutes,
      sessionCount: arr.filter(s => starts.has(s.id)).length,
      sharePct: totalMinutes ? (minutes / totalMinutes) * 100 : 0,
    };
  };

  return [row("night", night), row("day", day)];
}

export function generateInsights(sessions: SleepSession[], now: number, active: ActiveSleep | null = null, ageDays: number | null = null): Insight[] {
  const profile = computePersonalSleepProfile(sessions, now, active, ageDays);
  const insights: Insight[] = [];
  if (profile.typicalBedtime != null && profile.typicalWakeTime != null) {
    insights.push({ id: "typical-rhythm", payload: { bedtimeMin: profile.typicalBedtime, wakeMin: profile.typicalWakeTime } });
  }
  if (profile.medianWakeWindow != null) {
    insights.push({ id: "median-wake-window", payload: { medianMinutes: profile.medianWakeWindow } });
  }
  if (profile.usableDayCount >= 3) {
    if (profile.typicalNapCountPerDay && profile.medianNapDuration != null) {
      insights.push({ id: "typical-naps", payload: { count: profile.typicalNapCountPerDay, minutes: profile.medianNapDuration } });
    }
    if (profile.atNightPct != null) {
      insights.push({ id: "night-share", payload: { atNightPct: profile.atNightPct } });
    }
    if (profile.typicalLongestStretch != null) {
      insights.push({ id: "typical-longest-stretch", payload: { minutes: profile.typicalLongestStretch } });
    }
  }
  const trend = computeWeeklyTrend(sessions, now, active);
  // Use the Overview comparison, but reserve an insight for a substantial shift.
  if ((trend.direction === "more" || trend.direction === "less") && Math.abs(trend.diffMinutes) >= 30) {
    insights.push({ id: "weekly-sleep-change", payload: { minutes: trend.diffMinutes } });
  }
  return insights;
}
