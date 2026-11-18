import { SLEEP_FORECAST_MODEL_VERSION } from "./forecastModelVersion";

export type PredictionSnapshot = {
  readonly modelVersion: string;
  readonly predictedAt: number;
  readonly predictedSleepStart: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly horizon: number;
  readonly evidenceCount: number;
};

export type PredictionOutcome = {
  readonly actualSleepStart: number;
  readonly absoluteErrorMinutes: number;
  readonly insideWindow: boolean;
};

function validSnapshot(snapshot: Omit<PredictionSnapshot, "modelVersion">): boolean {
  const { predictedAt, predictedSleepStart, windowStart, windowEnd, horizon, evidenceCount } = snapshot;
  return [predictedAt, predictedSleepStart, windowStart, windowEnd].every(Number.isFinite) &&
    predictedAt <= windowStart && windowStart <= predictedSleepStart && predictedSleepStart <= windowEnd &&
    Number.isInteger(horizon) && horizon >= 1 && Number.isInteger(evidenceCount) && evidenceCount >= 0;
}

export function createPredictionSnapshot(input: Omit<PredictionSnapshot, "modelVersion">): PredictionSnapshot | null {
  return validSnapshot(input) ? { ...input, modelVersion: SLEEP_FORECAST_MODEL_VERSION } : null;
}

/** Compare against the actual onset for the same horizon. Missing outcomes remain unscored. */
export function evaluatePrediction(snapshot: PredictionSnapshot, actualSleepStart: number): PredictionOutcome | null {
  if (!validSnapshot(snapshot) || !Number.isFinite(actualSleepStart) || actualSleepStart < snapshot.predictedAt) return null;
  return {
    actualSleepStart,
    absoluteErrorMinutes: Math.abs(actualSleepStart - snapshot.predictedSleepStart) / 60000,
    insideWindow: actualSleepStart >= snapshot.windowStart && actualSleepStart <= snapshot.windowEnd,
  };
}
