import { estimateOnsetPeak, type OnsetPeak } from "./onsetPeak";
import { recordedIntervals, completedLocalDays, ageConservatism, recordedTransitionCheck, RECORDED_TRANSITION_RULE } from "./sleepHistory";
import { sequenceContext, sequenceSimilarity } from "./sleepSequence";
import { weightedMedianAbsoluteDeviation, weightedPercentile } from "./weightedStats";
import { computeWakeWindows } from "./wakeWindows";
import { dayKeyOf, minutesSinceLocalMidnight } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

export const NEXT_SLEEP_LOOKBACK_DAYS = 21;

// Product heuristics; research-informed but not clinically validated.
const NEXT_SLEEP_RULES = {
  minimumGapMinutes: 15, maxClockDistanceMinutes: 180, clockScaleMinutes: 240,
  minimumSamples: 6, minimumDays: 4, minimumRecentDays: 3, recentDays: 7,
  minimumRemainingSamples: 4, minimumRemainingDays: 3, expiryGraceMinutes: 20,
  baseTail: 0.2, youngTailReduction: 0.1,
  basePaddingMinutes: 10, agePaddingMinutes: 10, maxDispersionPaddingMinutes: 20,
  minimumWidthMinutes: 15, roundingMinutes: 5, maxCautionForHigherConfidence: 0.5,
  high: { days: 10, recentDays: 5, relativeSpread: 0.25 },
  medium: { days: 6, recentDays: 4, relativeSpread: 0.5 },
} as const;

export type NextSleepPrediction = {
  status: "ready" | "insufficient_data" | "sleeping";
  earliestStart?: number; likelyStart?: number; latestStart?: number;
  peak?: OnsetPeak;
  awakeMinutes?: number;
  typicalAwakeMinutes?: { min: number; max: number };
  confidence?: "low" | "medium" | "high";
  sampleSize: number;
};
type Sample = { minutes: number; weight: number; dayKey: string; startTs: number; similarity: number };
const quantile = (samples: Sample[], fraction: number) =>
  weightedPercentile(samples.map(s => ({ value: s.minutes, weight: s.weight })), fraction)!;

// Elapsed time since the last logged sleep is an anchor, not observed wake time.
export function calculateNextSleep({ sessions, active, now, ageDays = null }: {
  sessions: SleepSession[]; active: ActiveSleep | null; now: number; ageDays?: number | null;
}): NextSleepPrediction {
  const insufficient = (sampleSize = 0): NextSleepPrediction => ({ status: "insufficient_data", sampleSize });
  if (!Number.isFinite(now)) return insufficient();
  if (active) return active.startMs <= now ? { status: "sleeping", sampleSize: 0 } : insufficient();
  const intervals = recordedIntervals(sessions, now);
  const last = intervals[intervals.length - 1];
  if (!last) return insufficient();
  const awake = (now - last.endMs) / 60000;
  if (awake < 0 || awake > RECORDED_TRANSITION_RULE.maxGapMinutes) return insufficient();
  if (sessions.some(s => s.endMs > last.endMs || s.startMs > now)) return insufficient();
  const merged: SleepSession[] = intervals.map((s, i) => ({ ...s, id: String(i),
    durationMin: (s.endMs - s.startMs) / 60000, rate: null, note: null, sleepTypeRaw: "sleep" }));
  const clock = minutesSinceLocalMidnight(last.endMs);
  const calendar = new Map(completedLocalDays(now, NEXT_SLEEP_LOOKBACK_DAYS, ageDays).map(day => [day.localDate, day]));
  const context = sequenceContext(merged);
  const contextByEnd = new Map(merged.map((s, index) => [s.endMs, context[index]]));
  const hasCoverage = recordedTransitionCheck(intervals, sessions, now);
  const samples: Sample[] = computeWakeWindows(merged).windows.flatMap(w => {
    const day = calendar.get(dayKeyOf(w.endTs));
    if (!day || w.minutes < NEXT_SLEEP_RULES.minimumGapMinutes || !hasCoverage(w.startTs, w.endTs)) return [];
    const difference = Math.abs(minutesSinceLocalMidnight(w.startTs) - clock);
    const distance = Math.min(difference, 1440 - difference);
    if (distance > NEXT_SLEEP_RULES.maxClockDistanceMinutes) return [];
    const similarity = sequenceSimilarity(context.at(-1)!, contextByEnd.get(w.startTs)!);
    return [{ ...w, similarity, weight: day.weight * (1 - distance / NEXT_SLEEP_RULES.clockScaleMinutes) * similarity }];
  });
  const days = new Set(samples.map(s => s.dayKey)).size;
  const recentDays = new Set(samples.filter(s => (calendar.get(s.dayKey)?.daysAgo ?? Infinity) <= NEXT_SLEEP_RULES.recentDays).map(s => s.dayKey)).size;
  if (samples.length < NEXT_SLEEP_RULES.minimumSamples || days < NEXT_SLEEP_RULES.minimumDays || recentDays < NEXT_SLEEP_RULES.minimumRecentDays) return insufficient(samples.length);
  const caution = ageDays === null ? 1 : ageConservatism(ageDays);
  const tail = NEXT_SLEEP_RULES.baseTail - NEXT_SLEEP_RULES.youngTailReduction * caution;
  const min = quantile(samples, tail), max = quantile(samples, 1 - tail);
  const middle = quantile(samples, .5);
  const remaining = samples.filter(s => s.minutes > awake);
  // Compare later recorded onsets only within supported, bracketed transitions.
  if (remaining.length < NEXT_SLEEP_RULES.minimumRemainingSamples ||
    new Set(remaining.map(s => s.dayKey)).size < NEXT_SLEEP_RULES.minimumRemainingDays || awake >= max + NEXT_SLEEP_RULES.expiryGraceMinutes) return insufficient(samples.length);
  const deviation = weightedMedianAbsoluteDeviation(samples.map(s => ({ value: s.minutes, weight: s.weight }))) ?? 0;
  const padding = NEXT_SLEEP_RULES.basePaddingMinutes + NEXT_SLEEP_RULES.agePaddingMinutes * caution
    + Math.min(NEXT_SLEEP_RULES.maxDispersionPaddingMinutes, deviation / 2);
  const lower = Math.max(awake, min - padding);
  const upper = Math.max(max + padding, lower + NEXT_SLEEP_RULES.minimumWidthMinutes);
  if (upper > RECORDED_TRANSITION_RULE.maxGapMinutes) return insufficient(samples.length);
  const rounding = NEXT_SLEEP_RULES.roundingMinutes * 60000;
  const roundUp = (minutes: number) => Math.ceil((last.endMs + minutes * 60000) / rounding) * rounding;
  const earliestStart = roundUp(lower), latestStart = roundUp(upper);
  const variability = Math.max(max - min, 2 * deviation) / Math.max(1, middle);
  const meets = (band: typeof NEXT_SLEEP_RULES.high | typeof NEXT_SLEEP_RULES.medium) =>
    caution < NEXT_SLEEP_RULES.maxCautionForHigherConfidence && days >= band.days &&
    recentDays >= band.recentDays && variability < band.relativeSpread;
  const confidence = meets(NEXT_SLEEP_RULES.high) ? "high" : meets(NEXT_SLEEP_RULES.medium) ? "medium" : "low";
  const peak = confidence === "low" ? undefined : estimateOnsetPeak(remaining, last.endMs, now, earliestStart, latestStart, caution, deviation);
  return { ...(peak && { peak }), status: "ready", earliestStart, latestStart,
    likelyStart: Math.min(latestStart, Math.max(earliestStart, roundUp(quantile(remaining, .5)))),
    awakeMinutes: Math.floor(awake), typicalAwakeMinutes: { min: Math.floor(min / 5) * 5, max: Math.ceil(max / 5) * 5 },
    confidence, sampleSize: samples.length };
}
