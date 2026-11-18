import { weightedClockMedian, weightedPercentile } from "./weightedStats";
import { dayKeyOf, minutesSinceLocalMidnight } from "./time";
import { recencyWeightAt } from "./sleepHistory";
import { resolveSleepType } from "./sleepType";
import type { SleepSession } from "./types";

const MINUTE = 60000;
// Product heuristics; research-informed but not clinically validated.
const NIGHT_CLUSTER_RULES = {
  joinGapMinutes: 45, maxSpanMinutes: 14 * 60, minimumSleepMinutes: 180,
  matchRadiusMinutes: 120, alternativeSeparationMinutes: 240, alternativeSupportRatio: 0.7,
  minimumNights: 3, normalSupportNights: 5,
  sparseMaxDeviationMinutes: 45, normalDeviationPercentile: 0.8, normalMaxDeviationMinutes: 90,
} as const;
type Cluster = { sessions: SleepSession[]; minutes: number; clock: number; weight: number; day: string };
const explicit = (session: SleepSession) => session.sleepTypeRaw?.trim().toLowerCase();
const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));

/** Relabels copies for pattern analysis only. Ambiguous rhythms use existing inference. */
export function classifyRecentSleep(sessions: SleepSession[], now: number, ageDays: number | null): SleepSession[] {
  const groups: SleepSession[][] = [];
  let last: SleepSession[] | undefined;
  for (const sleep of sessions) {
    if (explicit(sleep) === "nap") { last = undefined; continue; }
    const previous = last?.at(-1);
    if (last && previous && sleep.startMs - previous.endMs <= NIGHT_CLUSTER_RULES.joinGapMinutes * MINUTE &&
        sleep.endMs - last[0].startMs <= NIGHT_CLUSTER_RULES.maxSpanMinutes * MINUTE) last.push(sleep);
    else { last = [sleep]; groups.push(last); }
  }
  const candidates: Cluster[] = groups.flatMap(group => {
    const first = group[0], last = group.at(-1)!;
    const minutes = group.reduce((sum, sleep) => sum + sleep.durationMin, 0);
    const weight = recencyWeightAt(first.startMs, now, ageDays);
    if (minutes < NIGHT_CLUSTER_RULES.minimumSleepMinutes || !weight) return [];
    const center = first.startMs + (last.endMs - first.startMs) / 2;
    return [{ sessions: group, minutes, clock: minutesSinceLocalMidnight(center), weight,
      day: dayKeyOf(first.startMs) }];
  });
  const support = (clock: number) => {
    const perDay = new Map<string, Cluster>();
    for (const c of candidates) {
      if (distance(c.clock, clock) > NIGHT_CLUSTER_RULES.matchRadiusMinutes) continue;
      const previous = perDay.get(c.day);
      if (!previous || previous.weight * previous.minutes < c.weight * c.minutes) perDay.set(c.day, c);
    }
    const nights = [...perDay.values()];
    return { nights, mass: nights.reduce((sum, c) => sum + c.weight * c.minutes, 0), clock };
  };
  const ranked = candidates.map(c => support(c.clock)).sort((a, b) => b.mass - a.mass);
  const main = ranked[0];
  if (!main || main.nights.length < NIGHT_CLUSTER_RULES.minimumNights || ranked.some(c =>
    distance(c.clock, main.clock) > NIGHT_CLUSTER_RULES.alternativeSeparationMinutes &&
    c.mass >= main.mass * NIGHT_CLUSTER_RULES.alternativeSupportRatio)) return sessions;

  const center = weightedClockMedian(main.nights.map(c => ({ value: c.clock, weight: c.weight })))!;
  const deviations = main.nights.map(c => ({ value: distance(c.clock, center), weight: c.weight }));
  const sparse = main.nights.length < NIGHT_CLUSTER_RULES.normalSupportNights;
  const spread = sparse ? Math.max(...deviations.map(d => d.value))
    : weightedPercentile(deviations, NIGHT_CLUSTER_RULES.normalDeviationPercentile)!;
  if (spread > (sparse ? NIGHT_CLUSTER_RULES.sparseMaxDeviationMinutes : NIGHT_CLUSTER_RULES.normalMaxDeviationMinutes)) return sessions;

  const night = new Set(main.nights.flatMap(c => c.sessions));
  return sessions.map(sleep => {
    const raw = explicit(sleep);
    const inferred = raw === "night" || raw === "nap" ? resolveSleepType(sleep) : night.has(sleep) ? "night" : "nap";
    return { ...sleep, sleepTypeRaw: inferred };
  });
}
