import { SLEEP_FORECAST_MODEL_VERSION } from "./forecastModelVersion";
import { createPredictionSnapshot, evaluatePrediction } from "./predictionEvaluation";
import { calculateDailySleepForecast, FORECAST_RULES } from "./dailySleepForecast";
import { ageInDays } from "./localDate";
import { calculateNextSleep } from "./nextSleep";
import { completedLocalDays, recordedIntervals } from "./sleepHistory";
import { dayKeyOf, median } from "./time";
import type { SleepSession } from "./types";

const MINUTE = 60000;
type ErrorSample = { error: number; covered: boolean };
type Summary = { evaluated: number; medianAbsoluteError: number | null; within15: number | null; within30: number | null; windowCoverage: number | null };

function summarize(samples: ErrorSample[]): Summary {
  const evaluated = samples.length;
  const share = (predicate: (sample: ErrorSample) => boolean) =>
    evaluated ? samples.filter(predicate).length / evaluated : null;
  return { evaluated, medianAbsoluteError: evaluated ? median(samples.map(sample => sample.error)) : null,
    within15: share(sample => sample.error <= 15), within30: share(sample => sample.error <= 30),
    windowCoverage: share(sample => sample.covered) };
}

/** Development-only. Replay at the first eligible wake-up on each completed date, using only
 * records completed at that point. Later events are used exclusively to score.
 */
export function backtestSleepPredictions(sessions: SleepSession[], now: number, birthDate?: string | null) {
  const evaluationDays = new Set(completedLocalDays(now).map(day => day.localDate));
  const actual = recordedIntervals(sessions, now);
  const visited = new Set<string>();
  const scores = new Map<number, ErrorSample[]>();
  let checkpoints = 0, forecasts = 0;
  const wakeUps = [...new Set(sessions.filter(s => s.endMs <= now && s.endMs > s.startMs &&
    evaluationDays.has(dayKeyOf(s.endMs))).map(s => s.endMs))].sort((a, b) => a - b);
  for (const checkpoint of wakeUps) {
    const day = dayKeyOf(checkpoint);
    if (visited.has(day)) continue;
    visited.add(day);
    checkpoints++;
    const history = sessions.filter(s => s.endMs <= checkpoint);
    const ageDays = ageInDays(birthDate, checkpoint);
    const prediction = calculateNextSleep({ sessions: history, active: null, now: checkpoint, ageDays });
    if (prediction.status !== "ready") continue;
    forecasts++;
    const forecast = calculateDailySleepForecast({ sessions: history, active: null, now: checkpoint, nextSleep: prediction, ageDays });
    const index = actual.findIndex(interval => interval.endMs === checkpoint);
    if (index < 0) continue; // Ambiguous overlapping registrations cannot be scored.
    // Preserve the Next Sleep target even if the later-nap forecast abstains.
    const windows = [{ earliestMs: prediction.earliestStart!, typicalMs: prediction.likelyStart!, latestMs: prediction.latestStart!, evidenceCount: prediction.sampleSize },
      ...forecast.predictedNaps.filter(nap => !nap.isNext).map(nap => ({ ...nap.onset, evidenceCount: nap.evidenceCount }))];
    for (const [offset, window] of windows.entries()) {
      const target = actual[index + 1 + offset], previous = actual[index + offset];
      if (!target || target.startMs - previous.endMs > FORECAST_RULES.maxWakeGapMinutes * MINUTE) break;
      if (offset > 0 && (dayKeyOf(target.startMs) !== day || (target.endMs - target.startMs) / MINUTE >= FORECAST_RULES.nightMinutes ||
        (previous.endMs - previous.startMs) / MINUTE >= FORECAST_RULES.nightMinutes)) break;
      const samples = scores.get(offset + 1) ?? [];
      const snapshot = createPredictionSnapshot({
        predictedAt: checkpoint, predictedSleepStart: window.typicalMs,
        windowStart: window.earliestMs, windowEnd: window.latestMs,
        horizon: offset + 1, evidenceCount: window.evidenceCount,
      });
      const outcome = snapshot && evaluatePrediction(snapshot, target.startMs);
      if (!outcome) continue;
      samples.push({ error: outcome.absoluteErrorMinutes, covered: outcome.insideWindow });
      scores.set(offset + 1, samples);
    }
  }
  return { modelVersion: SLEEP_FORECAST_MODEL_VERSION, checkpoints, forecasts, byHorizon: [...scores].map(([horizon, samples]) => ({ horizon, ...summarize(samples) })) };
}
