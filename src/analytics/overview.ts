import { computePersonalSleepProfile } from "./recentSleepProfile";
import { completedLocalDays, usableCompletedDays } from "./sleepHistory";
import { MAX_PLAUSIBLE_SESSION_MINUTES } from "./sleepEvidence";
import type { ActiveSleep, SleepSession } from "./types";
import { dayKeyOf } from "./time";
export type WindowAverage = {
  avgMinutes: number | null;
  daysWithData: number;
};

// Unweighted descriptive average of usable completed local days.
export function computeWindowAverage(
  sessions: SleepSession[],
  referenceNow: number,
  days: number,
  active: ActiveSleep | null = null
): WindowAverage {
  const selected = usableCompletedDays(sessions, referenceNow, active).filter(d => d.daysAgo <= days);
  return { avgMinutes: selected.length ? selected.reduce((sum, d) => sum + d.fragments.reduce((n, f) => n + (f.endMs - f.startMs) / 60000, 0), 0) / selected.length : null,
    daysWithData: selected.length };
}

export type WeeklyTrend =
  | { direction: "insufficient-history" }
  | { direction: "same" | "more" | "less"; diffMinutes: number };

export function computeWeeklyTrend(
  sessions: SleepSession[],
  now: number,
  active: ActiveSleep | null = null
): WeeklyTrend {
  // Equal-weight completed weeks preserve the meaning of a period comparison.
  const days = usableCompletedDays(sessions, now, active);
  const mean = (from: number, to: number) => {
    const selected = days.filter(d => d.daysAgo >= from && d.daysAgo <= to);
    return { avgMinutes: selected.length >= 3 ? selected.reduce((sum, d) => sum + d.fragments.reduce((n, f) => n + (f.endMs - f.startMs) / 60000, 0), 0) / selected.length : null };
  };
  const current = mean(1, 7), previous = mean(8, 14);

  if (current.avgMinutes == null || previous.avgMinutes == null) {
    return { direction: "insufficient-history" };
  }

  const diffMinutes = current.avgMinutes - previous.avgMinutes;

  if (Math.abs(diffMinutes) < 10) return { direction: "same", diffMinutes };

  return { direction: diffMinutes > 0 ? "more" : "less", diffMinutes };
}

export type OverviewKpis = {
  longestMinutes: number;
  atNightPct: number | null;
  napsPerDay: number | null;
};

export function computeKpis(sessions: SleepSession[], now: number, active: ActiveSleep | null = null): OverviewKpis {
  const profile = computePersonalSleepProfile(sessions, now, active);
  const keys = new Set(completedLocalDays(now).map(d => d.localDate));
  // Explicit factual record for the completed 30-day period, not a typical stretch.
  const longestMinutes = sessions.filter(s => keys.has(dayKeyOf(s.startMs)) && s.endMs <= now && s.durationMin > 0 && s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES)
    .reduce((max, s) => Math.max(max, s.durationMin), 0);
  return { longestMinutes, atNightPct: profile.atNightPct, napsPerDay: profile.typicalNapCountPerDay };
}

export type RhythmCard = {
  bedtimeMin: number | null;
  wakeMin: number | null;
  medianWakeWindowMinutes: number | null;
};

export function computeRhythmCard(sessions: SleepSession[], now: number, active: ActiveSleep | null = null): RhythmCard {
  const profile = computePersonalSleepProfile(sessions, now, active);
  return { bedtimeMin: profile.typicalBedtime, wakeMin: profile.typicalWakeTime, medianWakeWindowMinutes: profile.medianWakeWindow };
}
