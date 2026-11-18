import type { SleepSession } from "./types";
export type ProfileConfidence = "low" | "medium" | "high";
// Existing classifier/forecast guard: reject clearly broken registrations.
export const MAX_PLAUSIBLE_SESSION_MINUTES = 720;
export const MIN_DAYS_FOR_LOW_CONFIDENCE = 3;
export const MIN_DAYS_FOR_MEDIUM_CONFIDENCE = 7;
export const MIN_DAYS_FOR_HIGH_CONFIDENCE = 14;
// Preserve first-seen overlap handling for session observations. Coverage uses
// recordedIntervals' union instead, so duplicates cannot inflate usable days.
export function cleanPersonalSleepSessions(sessions: SleepSession[]): SleepSession[] {
  const valid = sessions.filter(
    (s) => s.durationMin > 0 && s.durationMin <= MAX_PLAUSIBLE_SESSION_MINUTES
  );

  const sorted = [...valid].sort((a, b) => a.startMs - b.startMs);
  const cleaned: SleepSession[] = [];

  for (const s of sorted) {
    const last = cleaned[cleaned.length - 1];
    if (last && s.startMs < last.endMs) continue; // overlaps the previous kept session
    cleaned.push(s);
  }

  return cleaned;
}

export function confidenceForHistoryDays(historyDays: number): ProfileConfidence {
  if (historyDays >= MIN_DAYS_FOR_HIGH_CONFIDENCE) return "high";
  if (historyDays >= MIN_DAYS_FOR_MEDIUM_CONFIDENCE) return "medium";
  return "low";
}

