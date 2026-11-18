import type { NextSleepPrediction } from "./nextSleep";
import { ageConservatism, completedLocalDays, recordedIntervals, recordedTransitionCheck, RECORDED_TRANSITION_RULE } from "./sleepHistory";
import { weightedPercentile } from "./weightedStats";
import { sequenceContext, sequenceSimilarity } from "./sleepSequence";
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
  activeAnchor?: ActiveSleep;
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

// Product heuristics; research-informed but not clinically validated.
export const FORECAST_RULES = {
  lookbackDays: 21,
  /** An episode at least this long is night-like and ends a daytime sequence. */
  nightMinutes: 180,
  /** Wakes this short inside a sleep are joined into one episode. */
  joinGapMinutes: 20,
  /** Longer gaps are missing logging, never confirmed wakefulness. */
  maxWakeGapMinutes: RECORDED_TRANSITION_RULE.maxGapMinutes,
  minScenarioDays: 5,
  minEffectiveEvidence: 3,
  minEventDays: 3,
  /** Weighted share of scenarios that must contain the next event. */
  continueShare: 0.6,
  maxPredictedNaps: 4,
  maxRemainingDayNaps: 3,
  /** Later naps are daytime only: evening and night sleep is ambiguous
      between nap and bedtime and is never forecast. */
  earliestNapOnsetClock: 6 * 60,
  latestNapOnsetClock: 20 * 60,
  minSimilarity: 0.1,
  clockSimilarityMinutes: 90,
  unknownNapCountWeight: 0.8,
  napCountDifferenceWeight: 0.6,
  maxOnsetWidthMinutes: 150,
  ageWidthReductionMinutes: 30,
  laterWidthGrowthMinutes: 5,
  baseTail: 0.2,
  ageTailReduction: 0.1,
  youngCaution: 0.5,
  minimumDurationSpreadAllowance: 45,
  relativeDurationSpreadAllowance: 1.2,
  extraLaterEffectiveEvidence: 1,
  highEvidence: 6,
  mediumEvidence: 4,
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

const weightedQuantile = (items: Weighted[], q: number) => weightedPercentile(items, q)!;
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
export function historicalScenarios(sessions: SleepSession[], now: number, ageDays: number | null = null): { scenarios: Scenario[]; last: Episode | null } {
  const all = episodes(sessions, now);
  const hasCoverage = recordedTransitionCheck(all, sessions, now);
  const last = all[all.length - 1] ?? null;
  if (!last) return { scenarios: [], last };
  const awake = (now - last.endMs) / MINUTE;
  const clock = minutesSinceLocalMidnight(last.endMs);
  const best = new Map<string, Scenario>();
  const calendar = new Map(completedLocalDays(now, FORECAST_RULES.lookbackDays, ageDays).map(day => [day.localDate, day.weight]));
  const context = sequenceContext(all);
  all.forEach((anchor, index) => {
    const recency = calendar.get(dayKeyOf(anchor.endMs)) ?? 0;
    const next = all[index + 1];
    if (!recency || anchor.night !== last.night || !next) return;
    const gap = (next.startMs - anchor.endMs) / MINUTE;
    // Match the elapsed point only within a supported transition between records.
    if (!hasCoverage(anchor.endMs, next.startMs) || gap < awake) return;
    const countFactor = last.napsSinceNight === null || anchor.napsSinceNight === null ? FORECAST_RULES.unknownNapCountWeight
      : FORECAST_RULES.napCountDifferenceWeight ** Math.abs(last.napsSinceNight - anchor.napsSinceNight);
    const weight = recency * Math.exp(-clockDistance(minutesSinceLocalMidnight(anchor.endMs), clock) / FORECAST_RULES.clockSimilarityMinutes) * countFactor
      * sequenceSimilarity(context.at(-1)!, context[index]);
    if (weight < FORECAST_RULES.minSimilarity) return;
    const day = dayKeyOf(anchor.endMs);
    if ((best.get(day)?.weight ?? 0) >= weight) return;
    const naps: Scenario["naps"] = [];
    let ended: Scenario["ended"] = "incomplete", previousEnd = anchor.endMs;
    for (const event of all.slice(index + 1)) {
      if (!hasCoverage(previousEnd, event.startMs)) break;
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
  // Active daytime sleep uses conditional historical continuations.
  if (active) return activeDaytimeForecast(sessions, active, now, ageDays);
  if (nextSleep.status === "sleeping") return result("sleeping");
  if (nextSleep.status !== "ready" || !Number.isFinite(nextSleep.earliestStart) || !Number.isFinite(nextSleep.latestStart)
    || nextSleep.earliestStart! < now) return result("insufficient_data");

  const caution = ageDays === null ? 1 : ageConservatism(ageDays);
  const young = caution >= FORECAST_RULES.youngCaution;
  const lo = FORECAST_RULES.baseTail - FORECAST_RULES.ageTailReduction * caution, hi = 1 - lo;
  const first: PredictedNap = { id: "nap-1", sequenceIndex: 1, isNext: true, quality: nextSleep.confidence ?? "low",
    onset: { earliestMs: nextSleep.earliestStart!, typicalMs: nextSleep.likelyStart ?? nextSleep.earliestStart!, latestMs: nextSleep.latestStart! },
    evidenceCount: 0, effectiveEvidence: 0 };
  const naps: PredictedNap[] = [first];
  const stop = (reason: ForecastStopReason) => { diagnostics.stopReason = reason; return result(naps.length > 1 ? "ready" : "partial", naps); };

  const { scenarios, last } = historicalScenarios(sessions, now, ageDays);
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
  for (let k = 1; k <= FORECAST_RULES.maxRemainingDayNaps; k++) {
    // Scenarios still informative at depth k: they either contain nap k, or
    // reached a night-like sleep before it. Incomplete logs are not votes.
    const withNap = scenarios.filter(s => s.naps.length >= k);
    const endedBefore = scenarios.filter(s => s.naps.length < k && s.ended === "night");
    const share = withNap.reduce((a, s) => a + s.weight, 0) / Math.max(1e-9, [...withNap, ...endedBefore].reduce((a, s) => a + s.weight, 0));
    const support = withNap.map(s => ({ weight: s.weight, day: s.day }));
    if (share < FORECAST_RULES.continueShare) return stop("night-likely");
    if (effective(support) < FORECAST_RULES.minEffectiveEvidence + (k > 1 ? FORECAST_RULES.extraLaterEffectiveEvidence * caution : 0) || days(support) < FORECAST_RULES.minEventDays)
      return stop("insufficient-continuations");

    const nap = k === 1 ? previous : null;
    const durations = withNap.map(s => ({ value: s.naps[k - 1].durationMin, weight: s.weight, day: s.day }));
    const typicalDuration = weightedQuantile(durations, 0.5);
    const duration: DurationInterval = { lowMin: Math.floor(weightedQuantile(durations, lo) / 5) * 5,
      typicalMin: Math.round(typicalDuration / 5) * 5, highMin: Math.ceil(weightedQuantile(durations, hi) / 5) * 5 };
    const durationSupported = (duration.highMin - duration.lowMin) <= Math.max(FORECAST_RULES.minimumDurationSpreadAllowance, FORECAST_RULES.relativeDurationSpreadAllowance * typicalDuration);
    const quality: ForecastQuality = effective(support) >= FORECAST_RULES.highEvidence && days(support) >= FORECAST_RULES.highEvidence ? "high" : effective(support) >= FORECAST_RULES.mediumEvidence ? "medium" : "low";

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
      const shortfall = (previous.onset.latestMs - previous.onset.earliestMs + FORECAST_RULES.laterWidthGrowthMinutes * MINUTE) - (onset.latestMs - onset.earliestMs);
      if (shortfall > 0) { onset.earliestMs = floor5(onset.earliestMs - shortfall / 2); onset.latestMs = ceil5(onset.latestMs + shortfall / 2); }
      const previousEnd = previous.wakeTime?.typicalMs ?? previous.onset.typicalMs;
      if (onset.latestMs - onset.earliestMs > (FORECAST_RULES.maxOnsetWidthMinutes - FORECAST_RULES.ageWidthReductionMinutes * caution) * MINUTE) return stop("horizon");
      if (onset.earliestMs < now || onset.typicalMs <= previousEnd) return stop("incoherent");
      const onsetClock = minutesSinceLocalMidnight(onset.typicalMs);
      if (dayKeyOf(onset.typicalMs) !== dayKeyOf(first.onset.typicalMs) || onsetClock >= FORECAST_RULES.latestNapOnsetClock
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

/* ------------------------------------------------------------------------
   Upcoming-day (preliminary) forecast for the night.

   At night the remaining-day forecast has nothing to say: an active night
   sleep has no known end, and later naps are daytime-only. This forecasts the
   next daytime period instead, from whole historical days anchored at their
   morning wake-up. Each scenario keeps its own wake time and nap clock times
   together (one coherent trajectory), so uncertainty about the unknown
   morning wake-up is carried into every nap window rather than added on top
   of an average. Conditioning on the current night uses only what is known
   now: the bedtime, and that the baby has not woken for the morning yet. */

export const NIGHT_CONTEXT = {
  /** An active sleep starting in [from, until) local time is a night sleep. */
  activeNightFrom: 19 * 60,
  /** Awake in [from, until) local time without a morning wake is night. */
  awakeNightFrom: 20 * 60,
  nightUntil: 6 * 60,
  /** A night-like episode ending in this window is a morning wake-up. */
  morningWakeFrom: 4 * 60,
  morningWakeUntil: 11 * 60,
} as const;

export type UpcomingDayForecast = {
  status: "ready" | "insufficient_data" | "not_applicable";
  /** Local calendar day (YYYY-MM-DD) the forecast describes. */
  targetDay: string | null;
  targetDayStartMs: number | null;
  morningWake: ForecastInterval | null;
  predictedNaps: PredictedNap[];
  lastUpdated: number;
  diagnostics: { scenarioDays: number; effectiveSampleSize: number; stopReason: ForecastStopReason };
};

type DayScenario = { day: string; weight: number; wakeClock: number; naps: { onsetClock: number; durationMin: number }[]; ended: "night" | "incomplete" };

const inWindow = (clock: number, from: number, until: number) => from <= until ? clock >= from && clock < until : clock >= from || clock < until;
const sameLocalDay = (a: number, b: number) => dayKeyOf(a) === dayKeyOf(b);
/** Preliminary windows are never narrower than this, even for a perfectly
    regular history: the morning wake-up is still unknown. */
const MIN_PRELIMINARY_WIDTH = 30 * MINUTE;
function atLeast(interval: ForecastInterval, width: number): ForecastInterval {
  const missing = width - (interval.latestMs - interval.earliestMs);
  if (missing <= 0) return interval;
  return { earliestMs: floor5(interval.earliestMs - missing / 2), typicalMs: interval.typicalMs, latestMs: ceil5(interval.latestMs + missing / 2) };
}
function localDayStart(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}
/** Local wall-clock minutes on a local day, as an instant (DST-aware). */
function onDay(dayKey: string, minutes: number): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), Math.round(minutes % 60)).getTime();
}

/** Night context and the local day a preliminary forecast should describe. */
export function nightContext(sessions: SleepSession[], active: ActiveSleep | null, now: number): { night: boolean; targetDay: string | null } {
  const clock = minutesSinceLocalMidnight(now);
  const target = () => {
    if (clock < 12 * 60) return dayKeyOf(now);
    const tomorrow = new Date(startOfLocalDay(now)); tomorrow.setDate(tomorrow.getDate() + 1);
    return dayKeyOf(tomorrow.getTime());
  };
  if (active && Number.isFinite(active.startMs) && active.startMs <= now) {
    const night = inWindow(minutesSinceLocalMidnight(active.startMs), NIGHT_CONTEXT.activeNightFrom, NIGHT_CONTEXT.nightUntil)
      || (now - active.startMs) / MINUTE >= FORECAST_RULES.nightMinutes;
    return { night, targetDay: night ? target() : null };
  }
  if (!inWindow(clock, NIGHT_CONTEXT.awakeNightFrom, NIGHT_CONTEXT.nightUntil)) return { night: false, targetDay: null };
  // Awake before 06:00 after a night-like sleep that ended from 04:00 today:
  // that is the morning wake-up, so the daytime forecast takes over.
  const all = episodes(sessions, now), last = all[all.length - 1];
  if (last?.night && clock < NIGHT_CONTEXT.nightUntil && sameLocalDay(last.endMs, now)
    && inWindow(minutesSinceLocalMidnight(last.endMs), NIGHT_CONTEXT.morningWakeFrom, NIGHT_CONTEXT.morningWakeUntil)) return { night: false, targetDay: null };
  return { night: true, targetDay: target() };
}

export function upcomingDayScenarios(sessions: SleepSession[], active: ActiveSleep | null, now: number, targetDay: string, ageDays: number | null = null): DayScenario[] {
  const all = episodes(sessions, now);
  const hasCoverage = recordedTransitionCheck(all, sessions, now);
  const targetIsToday = targetDay === dayKeyOf(now), nowClock = minutesSinceLocalMidnight(now);
  // Tonight's bedtime, when known: the active sleep, or the night-like
  // episode currently interrupted by a night waking.
  const interrupted = [...all].reverse().find(e => e.night && now - e.endMs < 8 * 3600000);
  const tonight = active?.startMs ?? interrupted?.startMs ?? null;
  const best = new Map<string, DayScenario>();
  const calendar = new Map(completedLocalDays(now, undefined, ageDays).map(day => [day.localDate, day.weight]));
  all.forEach((anchor, index) => {
    if (!anchor.night) return;
    const day = dayKeyOf(anchor.endMs), wakeClock = minutesSinceLocalMidnight(anchor.endMs);
    if (day >= targetDay || !inWindow(wakeClock, NIGHT_CONTEXT.morningWakeFrom, NIGHT_CONTEXT.morningWakeUntil)) return;
    if (tonight !== null && anchor.startMs >= tonight) return; // tonight itself is not history
    // Only an active sleep supplies evidence that the current sleep has not ended.
    if (targetIsToday && active && active.startMs <= now && wakeClock <= nowClock) return;
    const recency = calendar.get(day) ?? 0;
    if (!recency) return;
    const bedtime = tonight === null ? 1
      : Math.exp(-clockDistance(minutesSinceLocalMidnight(anchor.startMs), minutesSinceLocalMidnight(tonight)) / FORECAST_RULES.clockSimilarityMinutes);
    const weight = recency * bedtime;
    if (weight < FORECAST_RULES.minSimilarity || (best.get(day)?.weight ?? 0) >= weight) return;
    const naps: DayScenario["naps"] = [];
    let ended: DayScenario["ended"] = "incomplete", previousEnd = anchor.endMs;
    for (const event of all.slice(index + 1)) {
      if (!hasCoverage(previousEnd, event.startMs)) break;
      if (event.night) { ended = "night"; break; }
      naps.push({ onsetClock: minutesSinceLocalMidnight(event.startMs), durationMin: event.minutes });
      previousEnd = event.endMs;
    }
    best.set(day, { day, weight, wakeClock, naps, ended });
  });
  return [...best.values()];
}

export function calculateUpcomingDayForecast({ sessions, active, now, ageDays = null }: {
  sessions: SleepSession[]; active: ActiveSleep | null; now: number; ageDays?: number | null;
}): UpcomingDayForecast {
  const { night, targetDay } = nightContext(sessions, active, now);
  const diagnostics: UpcomingDayForecast["diagnostics"] = { scenarioDays: 0, effectiveSampleSize: 0, stopReason: null };
  const base = { targetDay, targetDayStartMs: targetDay ? localDayStart(targetDay) : null, lastUpdated: now, diagnostics };
  if (!night || !targetDay || !Number.isFinite(now)) return { ...base, status: "not_applicable", morningWake: null, predictedNaps: [] };
  const insufficient = (reason: ForecastStopReason): UpcomingDayForecast => {
    diagnostics.stopReason = reason;
    return { ...base, status: "insufficient_data", morningWake: null, predictedNaps: [] };
  };

  const scenarios = upcomingDayScenarios(sessions, active, now, targetDay, ageDays);
  diagnostics.scenarioDays = days(scenarios);
  diagnostics.effectiveSampleSize = Math.round(effective(scenarios) * 10) / 10;
  if (diagnostics.scenarioDays < FORECAST_RULES.minScenarioDays || effective(scenarios) < FORECAST_RULES.minEffectiveEvidence)
    return insufficient("insufficient-continuations");

  const caution = ageDays === null ? 1 : ageConservatism(ageDays);
  const young = caution >= FORECAST_RULES.youngCaution;
  // The morning wake-up is still unknown: use the wider P10–P90 band for every
  // preliminary window (backtested: P20–P80 covered only ~55% of nap onsets).
  const [lo, hi] = [0.1, 0.9];
  const wakes = scenarios.map(s => ({ value: s.wakeClock, weight: s.weight, day: s.day }));
  const morningWake: ForecastInterval = atLeast({
    earliestMs: floor5(onDay(targetDay, weightedQuantile(wakes, lo))),
    typicalMs: round5(onDay(targetDay, weightedQuantile(wakes, 0.5))),
    latestMs: ceil5(onDay(targetDay, weightedQuantile(wakes, hi))) }, MIN_PRELIMINARY_WIDTH);
  morningWake.earliestMs = Math.max(ceil5(now), morningWake.earliestMs);
  if (morningWake.latestMs <= morningWake.earliestMs) return insufficient("incoherent");
  morningWake.typicalMs = Math.min(morningWake.latestMs, Math.max(morningWake.earliestMs, morningWake.typicalMs));

  const naps: PredictedNap[] = [];
  let previousEnd = morningWake.typicalMs, previousWidth = morningWake.latestMs - morningWake.earliestMs;
  let previousQuality: ForecastQuality = young ? "low" : "medium";
  for (let k = 1; k <= FORECAST_RULES.maxPredictedNaps; k++) {
    const withNap = scenarios.filter(s => s.naps.length >= k);
    const endedBefore = scenarios.filter(s => s.naps.length < k && s.ended === "night");
    const share = withNap.reduce((a, s) => a + s.weight, 0) / Math.max(1e-9, [...withNap, ...endedBefore].reduce((a, s) => a + s.weight, 0));
    const support = withNap.map(s => ({ weight: s.weight, day: s.day }));
    if (share < FORECAST_RULES.continueShare) { diagnostics.stopReason = "night-likely"; break; }
    if (effective(support) < FORECAST_RULES.minEffectiveEvidence || days(support) < FORECAST_RULES.minEventDays) {
      diagnostics.stopReason = "insufficient-continuations"; break;
    }
    // Absolute clock times from whole days: wake-time and wake-window
    // variability stay together within each scenario.
    const onsets = withNap.map(s => ({ value: s.naps[k - 1].onsetClock, weight: s.weight, day: s.day }));
    const onset: ForecastInterval = atLeast({ earliestMs: floor5(onDay(targetDay, weightedQuantile(onsets, lo))),
      typicalMs: round5(onDay(targetDay, weightedQuantile(onsets, 0.5))), latestMs: ceil5(onDay(targetDay, weightedQuantile(onsets, hi))) },
      Math.max(MIN_PRELIMINARY_WIDTH, previousWidth + (k > 1 ? FORECAST_RULES.laterWidthGrowthMinutes * MINUTE : 0)));
    onset.earliestMs = Math.max(onset.earliestMs, morningWake.earliestMs);
    onset.typicalMs = Math.min(onset.latestMs, Math.max(onset.earliestMs, onset.typicalMs));
    const onsetClock = minutesSinceLocalMidnight(onset.typicalMs);
    if (onset.typicalMs <= previousEnd || onset.earliestMs < now) { diagnostics.stopReason = "incoherent"; break; }
    if (onsetClock < FORECAST_RULES.earliestNapOnsetClock || onsetClock >= FORECAST_RULES.latestNapOnsetClock) {
      diagnostics.stopReason = "evening"; break;
    }
    const quality = minQuality(previousQuality, k === 1 && !young ? "medium" : "low");
    const nap: PredictedNap = { id: `upcoming-${k}`, sequenceIndex: k, isNext: false, onset, quality,
      evidenceCount: days(support), effectiveEvidence: Math.round(effective(support) * 10) / 10 };
    const durations = withNap.map(s => ({ value: s.naps[k - 1].durationMin, weight: s.weight, day: s.day }));
    const typical = weightedQuantile(durations, 0.5);
    const duration: DurationInterval = { lowMin: Math.floor(weightedQuantile(durations, lo) / 5) * 5,
      typicalMin: Math.round(typical / 5) * 5, highMin: Math.ceil(weightedQuantile(durations, hi) / 5) * 5 };
    naps.push(nap);
    // A later nap depends on this one's unknown length: stop without support.
    if ((duration.highMin - duration.lowMin) > Math.max(FORECAST_RULES.minimumDurationSpreadAllowance, FORECAST_RULES.relativeDurationSpreadAllowance * typical)) { diagnostics.stopReason = "duration-unknown"; break; }
    nap.durationMinutes = duration;
    nap.wakeTime = { earliestMs: onset.earliestMs + duration.lowMin * MINUTE, typicalMs: onset.typicalMs + duration.typicalMin * MINUTE,
      latestMs: onset.latestMs + duration.highMin * MINUTE };
    previousEnd = nap.wakeTime.typicalMs; previousWidth = onset.latestMs - onset.earliestMs; previousQuality = quality;
    if (k === FORECAST_RULES.maxPredictedNaps) diagnostics.stopReason = "horizon";
  }
  if (!naps.length) return insufficient(diagnostics.stopReason ?? "insufficient-continuations");
  return { ...base, status: "ready", morningWake, predictedNaps: naps };
}

/** Conditional continuations observed inside a daytime episode. No estimated
 * end is inserted into history: every wake and later onset stays paired. */
function activeDaytimeForecast(sessions: SleepSession[], active: ActiveSleep, now: number, ageDays: number | null): DailySleepForecast {
  const calendar = new Map(completedLocalDays(now, FORECAST_RULES.lookbackDays, ageDays).map(day => [day.localDate, day.weight]));
  const caution = ageDays === null ? 1 : ageConservatism(ageDays);
  const diagnostics: DailySleepForecast["diagnostics"] = { scenarioDays: 0, effectiveSampleSize: 0, nextSleepAgreement: "not-evaluated", stopReason: null };
  const predictedNaps: PredictedNap[] = [];
  const finish = (reason: ForecastStopReason): DailySleepForecast => {
    diagnostics.stopReason = reason;
    return { status: predictedNaps.length ? "partial" : "sleeping", activeAnchor: { ...active }, predictedNaps, lastUpdated: now, diagnostics };
  };
  if (!Number.isFinite(now) || !Number.isFinite(active.startMs) || active.startMs > now || nightContext(sessions, active, now).night) return finish(null);
  const all = episodes(sessions, now), previous = all[all.length - 1];
  const hasCoverage = recordedTransitionCheck(all, sessions, now);
  if (previous && previous.endMs > active.startMs) return finish("incoherent");
  const joined = previous && active.startMs - previous.endMs <= FORECAST_RULES.joinGapMinutes * MINUTE;
  const start = joined ? previous.startMs : active.startMs;
  const elapsed = (now - start) / MINUTE;
  if (elapsed >= FORECAST_RULES.nightMinutes || (joined && previous.night)) return finish(null);
  const ordinal = previous && active.startMs - previous.endMs <= FORECAST_RULES.maxWakeGapMinutes * MINUTE && previous.napsSinceNight !== null
    ? previous.napsSinceNight + (joined ? 0 : 1) : null;
  const best = new Map<string, Scenario & { wake: number }>();
  all.forEach((anchor, index) => {
    const day = dayKeyOf(anchor.startMs);
    const recency = calendar.get(day) ?? 0;
    if (anchor.night || anchor.minutes < elapsed || day >= dayKeyOf(start) || !recency) return;
    const weight = recency * Math.exp(-clockDistance(minutesSinceLocalMidnight(anchor.startMs), minutesSinceLocalMidnight(start)) / FORECAST_RULES.clockSimilarityMinutes)
      * (ordinal === null || anchor.napsSinceNight === null ? FORECAST_RULES.unknownNapCountWeight : FORECAST_RULES.napCountDifferenceWeight ** Math.abs(ordinal - anchor.napsSinceNight));
    if (weight < FORECAST_RULES.minSimilarity || (best.get(day)?.weight ?? 0) >= weight) return;
    const naps: Scenario["naps"] = []; let ended: Scenario["ended"] = "incomplete", end = anchor.endMs;
    for (const event of all.slice(index + 1)) {
      if (!hasCoverage(end, event.startMs)) break;
      if (event.night) { ended = "night"; break; }
      if (dayKeyOf(event.startMs) !== day) break;
      naps.push({ onsetOffsetMin: (event.startMs - anchor.startMs) / MINUTE, durationMin: event.minutes }); end = event.endMs;
    }
    best.set(day, { day, weight, naps, ended, wake: anchor.minutes });
  });
  const scenarios = [...best.values()];
  diagnostics.scenarioDays = days(scenarios); diagnostics.effectiveSampleSize = effective(scenarios);
  if (days(scenarios) < FORECAST_RULES.minScenarioDays || effective(scenarios) < FORECAST_RULES.minEffectiveEvidence) return finish("insufficient-continuations");
  const quantile = (rows: typeof scenarios, value: (s: typeof scenarios[number]) => number, q: number) => weightedQuantile(rows.map(s => ({ value: value(s), weight: s.weight, day: s.day })), q);
  const wakeLow = quantile(scenarios, s => s.wake, .1), wakeHigh = quantile(scenarios, s => s.wake, .9);
  if (wakeHigh - wakeLow > 90) return finish("duration-unknown");
  let previousEnd = start + wakeHigh * MINUTE, width = Math.max(30 * MINUTE, (wakeHigh - wakeLow) * MINUTE);
  const midnight = new Date(startOfLocalDay(now)); midnight.setDate(midnight.getDate() + 1);
  for (let k = 0; k < FORECAST_RULES.maxRemainingDayNaps; k++) {
    const support = scenarios.filter(s => s.naps.length > k), ended = scenarios.filter(s => s.naps.length <= k && s.ended === "night");
    const sum = (rows: typeof scenarios) => rows.reduce((v, s) => v + s.weight, 0);
    if (sum(support) / Math.max(1e-9, sum(support) + sum(ended)) < FORECAST_RULES.continueShare) return finish("night-likely");
    if (days(support) < FORECAST_RULES.minEventDays || effective(support) < FORECAST_RULES.minEffectiveEvidence) return finish("insufficient-continuations");
    const interval = (value: (s: typeof scenarios[number]) => number) => atLeast({ earliestMs: floor5(start + quantile(support, value, .1) * MINUTE), typicalMs: round5(start + quantile(support, value, .5) * MINUTE), latestMs: ceil5(start + quantile(support, value, .9) * MINUTE) }, width);
    const onset = interval(s => s.naps[k].onsetOffsetMin);
    // Marginal uncertainty bands may overlap across coherent trajectories.
    // Check the paired wake gap, and keep typical rendered waves disjoint.
    const gapLow = quantile(support, s => s.naps[k].onsetOffsetMin - (k === 0 ? s.wake
      : s.naps[k - 1].onsetOffsetMin + s.naps[k - 1].durationMin), .1);
    if (gapLow <= FORECAST_RULES.joinGapMinutes || onset.earliestMs < now
      || (k === 0 ? onset.earliestMs < previousEnd : onset.typicalMs <= previousEnd)) return finish("incoherent");
    if (onset.latestMs - onset.earliestMs > (FORECAST_RULES.maxOnsetWidthMinutes - FORECAST_RULES.ageWidthReductionMinutes * caution) * MINUTE) return finish("horizon");
    if (onset.latestMs >= midnight.getTime() || minutesSinceLocalMidnight(onset.latestMs) >= FORECAST_RULES.latestNapOnsetClock || minutesSinceLocalMidnight(onset.earliestMs) < FORECAST_RULES.earliestNapOnsetClock) return finish("evening");
    const lowMin = quantile(support, s => s.naps[k].durationMin, .1), highMin = quantile(support, s => s.naps[k].durationMin, .9), typicalMin = quantile(support, s => s.naps[k].durationMin, .5);
    const nap: PredictedNap = { id: "active-nap-" + (k + 1), sequenceIndex: k + 1, isNext: false, onset, quality: caution >= FORECAST_RULES.youngCaution || k > 0 || effective(support) < FORECAST_RULES.mediumEvidence ? "low" : "medium", evidenceCount: days(support), effectiveEvidence: effective(support) };
    predictedNaps.push(nap);
    if (highMin - lowMin > Math.max(FORECAST_RULES.minimumDurationSpreadAllowance, FORECAST_RULES.relativeDurationSpreadAllowance * typicalMin)) return finish("duration-unknown");
    nap.durationMinutes = { lowMin, typicalMin, highMin };
    nap.wakeTime = interval(s => s.naps[k].onsetOffsetMin + s.naps[k].durationMin);
    if (nap.wakeTime.typicalMs <= onset.typicalMs) { predictedNaps.pop(); return finish("incoherent"); }
    previousEnd = nap.wakeTime.typicalMs; width = onset.latestMs - onset.earliestMs + FORECAST_RULES.laterWidthGrowthMinutes * MINUTE;
  }
  return finish("horizon");
}
