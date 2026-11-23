import { completedLocalDays, recordedIntervals } from "./sleepHistory";
import { recentSleepEvidence, computePersonalSleepProfile, hasDisplayableSleepProfile } from "./recentSleepProfile";
import { calculateSleepProbability, MIN_SLEEP_PROBABILITY_DAYS } from "./sleepProbability";
import { generateInsights } from "./insights";
import type { ActiveSleep, SleepSession } from "./types";

export function summarizeDataBasis(sessions: SleepSession[], active: ActiveSleep | null, now: number, time: string, ageDays: number | null = null) {
  const evidence = recentSleepEvidence(sessions, now, active, ageDays);
  const intervals = recordedIntervals(sessions, now);
  const usable = new Set(evidence.days.map(day => day.localDate));
  const days = completedLocalDays(now).reverse().map(day => {
    const overlaps = (interval: { startMs: number; endMs: number }) =>
      interval.startMs < day.endMs && interval.endMs > day.startMs;
    const recorded = sessions.filter(session => session.endMs > session.startMs && session.endMs <= now && overlaps(session));
    const state: "usable" | "partial" | "empty" = usable.has(day.localDate) ? "usable" : intervals.some(overlaps) ? "partial" : "empty";
    return { ...day, state, recorded };
  });
  const probability = calculateSleepProbability(sessions, time, now, active, ageDays);
  const profile = computePersonalSleepProfile(sessions, now, active, ageDays);
  return {
    days,
    recordedSessions: new Set(days.flatMap(day => day.recorded.map(session => session.id))).size,
    usableDays: evidence.days.length,
    usableSessions: evidence.observations.length,
    confidence: profile.confidence,
    profileReady: hasDisplayableSleepProfile(profile),
    insightsReady: generateInsights(sessions, now, active, ageDays).length > 0,
    probability,
    probabilityDaysNeeded: Math.max(0, MIN_SLEEP_PROBABILITY_DAYS - probability.usableDays),
  };
}
