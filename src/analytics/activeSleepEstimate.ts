import { classifyPersonalSleep, type ActiveSleepClassification, type ActiveSleepIdentity } from "./personalSleepClassification";
import { median } from "./time";
import type { SleepSession } from "./types";

export type ActiveSleepEstimate = {
  classification: ActiveSleepClassification;
  estimatedWakeTime: number | null;
};

// Shared by Home and ActivityKit. The window is anchored to sleep start, so a
// clock tick never changes either the classification or its optional estimate.
export function estimateActiveSleep(sessions: SleepSession[], active: ActiveSleepIdentity): ActiveSleepEstimate {
  const result = classifyPersonalSleep(sessions, active);
  if (result.classification !== "SHORT_SLEEP_LIKE") return { classification: result.classification, estimatedWakeTime: null };
  const minutes = median(result.shortSamples.map(session => session.durationMin));
  if (!Number.isFinite(minutes) || minutes < 1) return { classification: "UNCERTAIN", estimatedWakeTime: null };
  return { classification: "SHORT_SLEEP_LIKE", estimatedWakeTime: active.startMs + minutes * 60000 };
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
