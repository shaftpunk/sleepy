// Forecast compatibility: retain the existing 14-day estimator input unchanged.
// Analysis callers use computePersonalSleepProfile from recentSleepProfile.
import { cleanPersonalSleepSessions, confidenceForHistoryDays, MIN_DAYS_FOR_LOW_CONFIDENCE } from "./sleepEvidence";
export { cleanPersonalSleepSessions, confidenceForHistoryDays, MAX_PLAUSIBLE_SESSION_MINUTES, MIN_DAYS_FOR_LOW_CONFIDENCE, MIN_DAYS_FOR_MEDIUM_CONFIDENCE, MIN_DAYS_FOR_HIGH_CONFIDENCE } from "./sleepEvidence";
import { circularMeanTimeOfDay, dayKeyOf, median, minutesSinceLocalMidnight } from "./time";
import { resolveSleepType } from "./sleepType";
import { computeWakeWindows, type WakeWindow } from "./wakeWindows";
import { lastNLocalDayKeys, splitMinutesByLocalDay } from "./time";
import type { SleepSession } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERSONAL_SLEEP_LOOKBACK_DAYS = 14;

// A personal wake window needs at least this many samples in a time-of-day
// bucket before it's considered a reliable, reportable pattern.
const MIN_SAMPLES_FOR_TIME_OF_DAY_WINDOW = 2;
const MIN_NIGHT_SESSIONS_FOR_RHYTHM = 2;

export type ProfileConfidence = "low" | "medium" | "high";

export type PersonalSleepProfile = {
  historyDays: number;
  completedSessionCount: number;
  averageTotalSleepPerDay: number | null;
  averageNapCountPerDay: number | null;
  medianNapDuration: number | null;
  medianNightSleepDuration: number | null;
  medianWakeWindow: number | null;
  morningWakeWindow: number | null;
  middayWakeWindow: number | null;
  eveningWakeWindow: number | null;
  typicalBedtime: number | null;
  typicalWakeTime: number | null;
  confidence: ProfileConfidence;
};

function emptyProfile(historyDays: number, completedSessionCount: number): PersonalSleepProfile {
  return {
    historyDays,
    completedSessionCount,
    averageTotalSleepPerDay: null,
    averageNapCountPerDay: null,
    medianNapDuration: null,
    medianNightSleepDuration: null,
    medianWakeWindow: null,
    morningWakeWindow: null,
    middayWakeWindow: null,
    eveningWakeWindow: null,
    typicalBedtime: null,
    typicalWakeTime: null,
    // Lowest available confidence value — harmless, since every stat field
    // is null and the UI shows "not enough data yet" instead of rendering
    // this label at all.
    confidence: "low",
  };
}

function timeOfDayBucket(hour: number): "morning" | "midday" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

function medianForBucket(
  windows: WakeWindow[],
  bucket: "morning" | "midday" | "evening"
): number | null {
  const inBucket = windows.filter((w) => timeOfDayBucket(new Date(w.startTs).getHours()) === bucket);

  return inBucket.length >= MIN_SAMPLES_FOR_TIME_OF_DAY_WINDOW
    ? median(inBucket.map((w) => w.minutes))
    : null;
}


// Looks back up to `lookbackDays` (default 14, the widest tier in the
// gradual-availability model) and reports how many of those days actually
// had data — that count, not the requested window, is what drives
// `confidence` and the caller's empty-state decision.
export function computeForecastSleepProfile(
  sessions: SleepSession[],
  now: number,
  lookbackDays = PERSONAL_SLEEP_LOOKBACK_DAYS
): PersonalSleepProfile {
  const windowStart = now - lookbackDays * DAY_MS;
  const inWindow = sessions.filter((s) => s.startMs >= windowStart && s.startMs <= now);
  const cleaned = cleanPersonalSleepSessions(inWindow);

  const historyDays = new Set(cleaned.map((s) => dayKeyOf(s.startMs))).size;

  if (historyDays < MIN_DAYS_FOR_LOW_CONFIDENCE) {
    return emptyProfile(historyDays, cleaned.length);
  }

  // Preserve legacy forecast inputs; Analysis uses the recent profile.
  const keys = new Set(lastNLocalDayKeys(now, lookbackDays));
  const totals = new Map<string, number>();
  for (const s of cleaned) for (const f of splitMinutesByLocalDay(s.startMs, s.endMs)) {
    if (keys.has(f.dayKey)) totals.set(f.dayKey, (totals.get(f.dayKey) ?? 0) + f.minutes);
  }
  const averageTotalSleepPerDay = totals.size ? [...totals.values()].reduce((a, b) => a + b, 0) / totals.size : null;

  const napSessions = cleaned.filter((s) => resolveSleepType(s) === "nap");
  const nightSessions = cleaned.filter((s) => resolveSleepType(s) === "night");

  const averageNapCountPerDay = napSessions.length / historyDays;

  const medianNapDuration = napSessions.length
    ? median(napSessions.map((s) => s.durationMin))
    : null;

  const medianNightSleepDuration = nightSessions.length
    ? median(nightSessions.map((s) => s.durationMin))
    : null;

  const windows = computeWakeWindows(cleaned).windows;

  const medianWakeWindow = windows.length ? median(windows.map((w) => w.minutes)) : null;

  const morningWakeWindow = medianForBucket(windows, "morning");
  const middayWakeWindow = medianForBucket(windows, "midday");
  const eveningWakeWindow = medianForBucket(windows, "evening");

  const typicalBedtime =
    nightSessions.length >= MIN_NIGHT_SESSIONS_FOR_RHYTHM
      ? circularMeanTimeOfDay(nightSessions.map((s) => minutesSinceLocalMidnight(s.startMs)))
      : null;

  const typicalWakeTime =
    nightSessions.length >= MIN_NIGHT_SESSIONS_FOR_RHYTHM
      ? circularMeanTimeOfDay(nightSessions.map((s) => minutesSinceLocalMidnight(s.endMs)))
      : null;

  return {
    historyDays,
    completedSessionCount: cleaned.length,
    averageTotalSleepPerDay,
    averageNapCountPerDay,
    medianNapDuration,
    medianNightSleepDuration,
    medianWakeWindow,
    morningWakeWindow,
    middayWakeWindow,
    eveningWakeWindow,
    typicalBedtime,
    typicalWakeTime,
    confidence: confidenceForHistoryDays(historyDays),
  };
}

// Exported for sleepPrediction.ts, which needs the same time-of-day bucketing
// to pick the right personal wake window for "right now".
export { timeOfDayBucket };

export { computePersonalSleepProfile } from "./recentSleepProfile";
