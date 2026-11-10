import { cleanPersonalSleepSessions, MIN_DAYS_FOR_LOW_CONFIDENCE, PERSONAL_SLEEP_LOOKBACK_DAYS } from "./personalSleepProfile";
import { resolveSleepType } from "./sleepType";
import { dayKeyOf, median } from "./time";
import type { SleepSession } from "./types";

// A personal nap estimate, not an age-based awake-window prediction. Freeze
// the history window at sleep start so a clock tick never moves the estimate.
export function estimateActiveSleepWakeTime(
  sessions: SleepSession[],
  active: { id: string; startMs: number; sleepTypeRaw: string },
): number | null {
  if (!Number.isFinite(active.startMs) || resolveSleepType(active) !== "nap") return null;
  const cutoff = active.startMs - PERSONAL_SLEEP_LOOKBACK_DAYS * 86400000;
  const history = cleanPersonalSleepSessions(sessions.filter(s =>
    s.id !== active.id && s.startMs >= cutoff && s.endMs <= active.startMs));
  const naps = history.filter(s => resolveSleepType(s) === "nap");
  if (new Set(naps.map(s => dayKeyOf(s.startMs))).size < MIN_DAYS_FOR_LOW_CONFIDENCE) return null;
  const minutes = median(naps.map(s => s.durationMin));
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  return active.startMs + minutes * 60000;
}

export function estimatedSleepProgress(startMs: number, wakeMs: number | null, nowMs: number) {
  if (wakeMs == null || ![startMs, wakeMs, nowMs].every(Number.isFinite) || wakeMs <= startMs) return null;
  const remainingMs = Math.max(0, wakeMs - nowMs);
  return {
    progress: Math.max(0, Math.min(1, (nowMs - startMs) / (wakeMs - startMs))),
    remainingMinutes: Math.ceil(remainingMs / 60000),
    phase: nowMs >= wakeMs ? "past" as const : remainingMs <= 5 * 60000 ? "soon" as const : "remaining" as const,
  };
}
