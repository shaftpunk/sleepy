import type { NextSleepPrediction } from "./nextSleep";
import { getRecencyWeight, recordedIntervals } from "./sleepProbability";
import { dayKeyOf, minutesSinceLocalMidnight, startOfLocalDay } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

/* Remaining-day nap forecast from conditional historical continuations.

   Historical evidence -> forecast calculation. Pure: no React, storage, I/O or
   strings. All instants are epoch ms; clock comparisons use device-local time
   (the same convention as Next Sleep), and elapsed durations use instant
   arithmetic, so midnight and DST transitions keep real durations.

   Method. Today's situation (type and length of the last sleep, its local end
   time, naps since the last night sleep, minutes awake now) is matched against
   the equivalent observation point on each recent day: an episode of the same
   kind, after which the baby was still awake for at least as long as now. Only
   information available at that point is compared. The rest of that day as it
   actually happened (every later nap's onset and duration, until a night-like
   sleep) is one scenario. Successive events are summarised across scenarios
   with weighted percentiles, always taken from whole trajectories, so the
   nap-duration -> next-wake-window dependency within a day is preserved instead
   of adding independent averages. The first onset window is always the
   existing Next Sleep result; the forecast only adds later events, and
   abstains when evidence is thin, inconsistent or contradicts Next Sleep. */

export type ForecastQuality = "high" | "medium" | "low";
/** Epoch-ms instants. */
export type ForecastInterval = { earliestMs: number; typicalMs: number; latestMs: number };
/** Minutes. */
export type DurationInterval = { lowMin: number; typicalMin: number; highMin: number };
export type PredictedNap = {
  id: string;
  /** 1 = the next sleep (Next Sleep's window), 2+ = later naps today. */
  sequenceIndex: number;
  onset: ForecastInterval;
  durationMinutes?: DurationInterval;
  wakeTime?: ForecastInterval;
  quality: ForecastQuality;
  /** Distinct historical days supporting this event. */
  evidenceCount: number;
  /** Kish effective sample size of the weighted scenarios. */
  effectiveEvidence: number;
  isNext: boolean;
};
export type ForecastStopReason = "night-likely" | "insufficient-continuations" | "disagreement" | "horizon"
  | "evening" | "incoherent" | "duration-unknown" | null;
export type DailySleepForecast = {
  status: "ready" | "partial" | "insufficient_data" | "sleeping";
  predictedNaps: PredictedNap[];
  lastUpdated: number;
  diagnostics: {
    scenarioDays: number;
    effectiveSampleSize: number;
    nextSleepAgreement: "agree" | "disagree" | "not-evaluated";
    stopReason: ForecastStopReason;
  };
};

export const FORECAST_RULES = {
  lookbackDays: 21,
  /** An episode at least this long is night-like and ends a daytime sequence. */
  nightMinutes: 180,
  /** Wakes this short inside a sleep are joined into one episode. */
  joinGapMinutes: 20,
  /** Longer gaps are missing logging, never confirmed wakefulness. */
  maxWakeGapMinutes: 360,
  minScenarioDays: 5,
  minEffectiveEvidence: 3,
  minEventDays: 3,
  /** Weighted share of scenarios that must contain the next event. */
  continueShare: 0.6,
  maxPredictedNaps: 4,
  /** Later naps are daytime only: evening and night sleep is ambiguous
      between nap and bedtime and is never forecast. */
  earliestNapOnsetClock: 6 * 60,
  latestNapOnsetClock: 20 * 60,
  minSimilarity: 0.1,
  /** Next Sleep vs scenario median tolerance beyond its window. */
  agreementMarginMinutes: 30,
} as const;

type Episode = { startMs: number; endMs: number; minutes: number; night: boolean; napsSinceNight: number | null };
type Weighted = { value: number; weight: number; day: string };
type Scenario = { day: string; weight: number; naps: { onsetOffsetMin: number; durationMin: number }[]; ended: "night" | "incomplete" };

const MINUTE = 60000;

function episodes(sessions: SleepSession[], now: number): Episode[] {
  const merged: { startMs: number; endMs: number }[] = [];
  for (const interval of recordedIntervals(sessions, now)) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMs - previous.endMs <= FORECAST_RULES.joinGapMinutes * MINUTE) previous.endMs = interval.endMs;
    else merged.push({ ...interval });
  }
  let naps: number | null = null, lastNightEnd: number | null = null;
  return merged.map(e => {
    const minutes = (e.endMs - e.startMs) / MINUTE;
    const night = minutes >= FORECAST_RULES.nightMinutes;
    // A count is only meaningful when the preceding night was logged recently.
    if (lastNightEnd !== null && e.startMs - lastNightEnd > 20 * 60 * MINUTE) { naps = null; lastNightEnd = null; }
    if (night) { naps = 0; lastNightEnd = e.endMs; } else if (naps !== null) naps++;
    return { ...e, minutes, night, napsSinceNight: naps };
  });
}

function weightedQuantile(items: Weighted[], q: number): number {
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const target = sorted.reduce((sum, i) => sum + i.weight, 0) * q;
  let total = 0;
  for (const item of sorted) { total += item.weight; if (total >= target) return item.value; }
  return sorted[sorted.length - 1].value;
}
const effective = (items: { weight: number }[]) => {
  const sum = items.reduce((s, i) => s + i.weight, 0), squares = items.reduce((s, i) => s + i.weight ** 2, 0);
  return squares > 0 ? sum ** 2 / squares : 0;
};
const days = (items: { day: string }[]) => new Set(items.map(i => i.day)).size;
const clockDistance = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 1440 - d); };
const floor5 = (ms: number) => Math.floor(ms / (5 * MINUTE)) * 5 * MINUTE;
const ceil5 = (ms: number) => Math.ceil(ms / (5 * MINUTE)) * 5 * MINUTE;
const round5 = (ms: number) => Math.round(ms / (5 * MINUTE)) * 5 * MINUTE;
const rank = { low: 0, medium: 1, high: 2 } as const;
const minQuality = (a: ForecastQuality, b: ForecastQuality): ForecastQuality => rank[a] <= rank[b] ? a : b;

/** Matched historical continuations for the current observation point. */
export function historicalScenarios(sessions: SleepSession[], now: number): { scenarios: Scenario[]; last: Episode | null } {
  const all = episodes(sessions, now);
  const last = all[all.length - 1] ?? null;
  if (!last) return { scenarios: [], last };
  const awake = (now - last.endMs) / MINUTE;
  const clock = minutesSinceLocalMidnight(last.endMs);
  const best = new Map<string, Scenario>();
  all.forEach((anchor, index) => {
    const daysAgo = Math.floor((now - anchor.endMs) / 86400000);
    const recency = daysAgo >= 1 && daysAgo <= FORECAST_RULES.lookbackDays ? getRecencyWeight(daysAgo) : 0;
    const next = all[index + 1];
    if (!recency || anchor.night !== last.night || !next) return;
    const gap = (next.startMs - anchor.endMs) / MINUTE;
    // Equivalent observation point: still awake after the same elapsed time.
    if (gap > FORECAST_RULES.maxWakeGapMinutes || gap < awake) return;
    const countFactor = last.napsSinceNight === null || anchor.napsSinceNight === null ? 0.8
      : 0.6 ** Math.abs(last.napsSinceNight - anchor.napsSinceNight);
    const weight = recency * Math.exp(-clockDistance(minutesSinceLocalMidnight(anchor.endMs), clock) / 90) * countFactor
      * Math.exp(-Math.abs(Math.log(Math.max(1, anchor.minutes) / Math.max(1, last.minutes))) / 0.5);
    if (weight < FORECAST_RULES.minSimilarity) return;
    const day = dayKeyOf(anchor.endMs);
    if ((best.get(day)?.weight ?? 0) >= weight) return;
    const naps: Scenario["naps"] = [];
    let ended: Scenario["ended"] = "incomplete", previousEnd = anchor.endMs;
    for (const event of all.slice(index + 1)) {
      if ((event.startMs - previousEnd) / MINUTE > FORECAST_RULES.maxWakeGapMinutes) break;
      if (event.night) { ended = "night"; break; }
      naps.push({ onsetOffsetMin: (event.startMs - anchor.endMs) / MINUTE, durationMin: event.minutes });
      previousEnd = event.endMs;
    }
    best.set(day, { day, weight, naps, ended });
  });
  return { scenarios: [...best.values()], last };
}

export function calculateDailySleepForecast({ sessions, active, now, nextSleep, ageDays = null }: {
  sessions: SleepSession[]; active: ActiveSleep | null; now: number; nextSleep: NextSleepPrediction; ageDays?: number | null;
}): DailySleepForecast {
  const diagnostics: DailySleepForecast["diagnostics"] = { scenarioDays: 0, effectiveSampleSize: 0, nextSleepAgreement: "not-evaluated", stopReason: null };
  const result = (status: DailySleepForecast["status"], predictedNaps: PredictedNap[] = []): DailySleepForecast =>
    ({ status, predictedNaps, lastUpdated: now, diagnostics });
  // An active sleep has no known end: forecasting after it would invent one.
  if (active || nextSleep.status === "sleeping") return result("sleeping");
  if (nextSleep.status !== "ready" || !Number.isFinite(nextSleep.earliestStart) || !Number.isFinite(nextSleep.latestStart)
    || nextSleep.earliestStart! < now) return result("insufficient_data");

  const young = ageDays === null || ageDays < 90;
  const [lo, hi] = young ? [0.1, 0.9] : [0.2, 0.8];
  const first: PredictedNap = { id: "nap-1", sequenceIndex: 1, isNext: true, quality: nextSleep.confidence ?? "low",
    onset: { earliestMs: nextSleep.earliestStart!, typicalMs: nextSleep.likelyStart ?? nextSleep.earliestStart!, latestMs: nextSleep.latestStart! },
    evidenceCount: 0, effectiveEvidence: 0 };
  const naps: PredictedNap[] = [first];
  const stop = (reason: ForecastStopReason) => { diagnostics.stopReason = reason; return result(naps.length > 1 ? "ready" : "partial", naps); };

  const { scenarios, last } = historicalScenarios(sessions, now);
  diagnostics.scenarioDays = days(scenarios);
  diagnostics.effectiveSampleSize = Math.round(effective(scenarios) * 10) / 10;
  if (!last || diagnostics.scenarioDays < FORECAST_RULES.minScenarioDays) return stop("insufficient-continuations");

  // Consistency with Next Sleep (authoritative for the first onset).
  const firstOffsets = scenarios.flatMap(s => s.naps.length ? [{ value: s.naps[0].onsetOffsetMin, weight: s.weight, day: s.day }] : []);
  if (firstOffsets.length) {
    const median = last.endMs + weightedQuantile(firstOffsets, 0.5) * MINUTE, margin = FORECAST_RULES.agreementMarginMinutes * MINUTE;
    const agrees = median >= first.onset.earliestMs - margin && median <= first.onset.latestMs + margin;
    diagnostics.nextSleepAgreement = agrees ? "agree" : "disagree";
    if (!agrees) return stop("disagreement");
  }

  let previous = first;
  for (let k = 1; k <= FORECAST_RULES.maxPredictedNaps; k++) {
    // Scenarios still informative at depth k: they either contain nap k, or
    // reached a night-like sleep before it. Incomplete logs are not votes.
    const withNap = scenarios.filter(s => s.naps.length >= k);
    const endedBefore = scenarios.filter(s => s.naps.length < k && s.ended === "night");
    const share = withNap.reduce((a, s) => a + s.weight, 0) / Math.max(1e-9, [...withNap, ...endedBefore].reduce((a, s) => a + s.weight, 0));
    const support = withNap.map(s => ({ weight: s.weight, day: s.day }));
    if (share < FORECAST_RULES.continueShare) return stop("night-likely");
    if (effective(support) < FORECAST_RULES.minEffectiveEvidence || days(support) < FORECAST_RULES.minEventDays)
      return stop("insufficient-continuations");

    const nap = k === 1 ? previous : null;
    const durations = withNap.map(s => ({ value: s.naps[k - 1].durationMin, weight: s.weight, day: s.day }));
    const typicalDuration = weightedQuantile(durations, 0.5);
    const duration: DurationInterval = { lowMin: Math.floor(weightedQuantile(durations, lo) / 5) * 5,
      typicalMin: Math.round(typicalDuration / 5) * 5, highMin: Math.ceil(weightedQuantile(durations, hi) / 5) * 5 };
    const durationSupported = (duration.highMin - duration.lowMin) <= Math.max(45, 1.2 * typicalDuration);
    const quality: ForecastQuality = effective(support) >= 6 && days(support) >= 6 ? "high" : effective(support) >= 4 ? "medium" : "low";

    let current: PredictedNap;
    if (k === 1) current = { ...nap!, evidenceCount: days(support), effectiveEvidence: Math.round(effective(support) * 10) / 10 };
    else {
      // Offsets from the scenario's own first onset keep each trajectory whole.
      const offsets = withNap.map(s => ({ value: s.naps[k - 1].onsetOffsetMin - s.naps[0].onsetOffsetMin, weight: s.weight, day: s.day }));
      const onset: ForecastInterval = {
        earliestMs: floor5(first.onset.earliestMs + weightedQuantile(offsets, lo) * MINUTE),
        typicalMs: round5(first.onset.typicalMs + weightedQuantile(offsets, 0.5) * MINUTE),
        latestMs: ceil5(first.onset.latestMs + weightedQuantile(offsets, hi) * MINUTE) };
      onset.typicalMs = Math.min(onset.latestMs, Math.max(onset.earliestMs, onset.typicalMs));
      // Uncertainty never shrinks further ahead, even if fewer, tighter
      // scenarios support a later event: widen symmetrically if needed.
      const shortfall = (previous.onset.latestMs - previous.onset.earliestMs) - (onset.latestMs - onset.earliestMs);
      if (shortfall > 0) { onset.earliestMs = floor5(onset.earliestMs - shortfall / 2); onset.latestMs = ceil5(onset.latestMs + shortfall / 2); }
      const previousEnd = previous.wakeTime?.typicalMs ?? previous.onset.typicalMs;
      if (onset.earliestMs < now || onset.typicalMs <= previousEnd) return stop("incoherent");
      const dayStart = startOfLocalDay(first.onset.typicalMs), onsetClock = minutesSinceLocalMidnight(onset.typicalMs);
      if (onset.typicalMs >= dayStart + 24 * 3600000 || onsetClock >= FORECAST_RULES.latestNapOnsetClock
        || onsetClock < FORECAST_RULES.earliestNapOnsetClock) return stop("evening");
      // Horizon: never more certain than the event before it, capped by depth,
      // and always low for young babies whose rhythm is still forming.
      const horizonCap: ForecastQuality = young || k > 2 ? "low" : "medium";
      current = { id: `nap-${k}`, sequenceIndex: k, isNext: false, onset, evidenceCount: days(support),
        effectiveEvidence: Math.round(effective(support) * 10) / 10,
        quality: minQuality(minQuality(quality, horizonCap), previous.quality) };
      naps.push(current);
    }
    if (durationSupported) {
      current.durationMinutes = duration;
      current.wakeTime = { earliestMs: current.onset.earliestMs + duration.lowMin * MINUTE,
        typicalMs: current.onset.typicalMs + duration.typicalMin * MINUTE, latestMs: current.onset.latestMs + duration.highMin * MINUTE };
    }
    if (k === 1) naps[0] = current;
    // A later nap's timing depends on this nap's unknown length: without a
    // supported duration there is no coherent basis to continue.
    if (!durationSupported) return stop("duration-unknown");
    previous = current;
  }
  return stop("horizon");
}
