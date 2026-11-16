import { recordedIntervals, getRecencyWeight } from "./sleepProbability";
import { computeWakeWindows } from "./wakeWindows";
import { minutesSinceLocalMidnight } from "./time";
import type { ActiveSleep, SleepSession } from "./types";
import { MAX_PLAUSIBLE_SESSION_MINUTES } from "./personalSleepProfile";

export type NextSleepPrediction = {
  status: "ready" | "insufficient_data" | "sleeping";
  earliestStart?: number; likelyStart?: number; latestStart?: number;
  awakeMinutes?: number;
  typicalAwakeMinutes?: { min: number; max: number };
  confidence?: "low" | "medium" | "high";
  sampleSize: number;
};
type Sample = { minutes: number; weight: number; dayKey: string; startTs: number };
function quantile(samples: Sample[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a.minutes - b.minutes);
  const target = sorted.reduce((sum, s) => sum + s.weight, 0) * fraction;
  let total = 0;
  for (const s of sorted) { total += s.weight; if (total >= target) return s.minutes; }
  return sorted[sorted.length - 1].minutes;
}

// No completeness signal exists. Require three merged sleeps spanning >=12h
// around a sample and gaps <=6h (stricter than the shared 8h limit). This is
// only a coverage proxy: sparse/nap-only logs deliberately often abstain.
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
  if (awake < 0 || awake > 360) return insufficient();
  if (sessions.some(s => s.endMs > last.endMs || s.startMs > now)) return insufficient();
  const merged: SleepSession[] = intervals.map((s, i) => ({ ...s, id: String(i),
    durationMin: (s.endMs - s.startMs) / 60000, rate: null, note: null, sleepTypeRaw: "sleep" }));
  const clock = minutesSinceLocalMidnight(last.endMs);
  const samples: Sample[] = computeWakeWindows(merged).windows.flatMap(w => {
    const daysAgo = Math.floor((now - w.endTs) / 86400000);
    if (daysAgo < 0 || daysAgo > 21 || w.minutes < 15 || w.minutes > 360) return [];
    // Invalid intervening records are evidence of incomplete logging, not
    // permission to bridge the surrounding valid sessions into a wake period.
    if (sessions.some(s => s.startMs < w.endTs && s.endMs > w.startTs &&
      (s.durationMin <= 0 || s.durationMin > MAX_PLAUSIBLE_SESSION_MINUTES ||
        s.endMs <= s.startMs || (s.endMs - s.startMs) / 60000 > MAX_PLAUSIBLE_SESSION_MINUTES))) return [];
    if (merged.some(s => (s.endMs === w.startTs || s.startMs === w.endTs) &&
      s.durationMin > MAX_PLAUSIBLE_SESSION_MINUTES)) return [];
    const nearby = intervals.filter(s => s.startMs >= w.startTs - 18 * 3600000 && s.endMs <= w.endTs + 18 * 3600000);
    if (nearby.length < 3 || nearby[nearby.length - 1].endMs - nearby[0].startMs < 12 * 3600000) return [];
    if (nearby.some((s, i) => i > 0 && s.startMs - nearby[i - 1].endMs > 360 * 60000)) return [];
    const difference = Math.abs(minutesSinceLocalMidnight(w.startTs) - clock);
    const distance = Math.min(difference, 1440 - difference);
    if (distance > 180) return [];
    return [{ ...w, weight: getRecencyWeight(Math.max(1, daysAgo)) * (1 - distance / 240) }];
  });
  const days = new Set(samples.map(s => s.dayKey)).size;
  const recentDays = new Set(samples.filter(s => now - s.startTs < 7 * 86400000).map(s => s.dayKey)).size;
  if (samples.length < 6 || days < 4 || recentDays < 3) return insufficient(samples.length);
  const young = ageDays === null || ageDays < 90;
  const min = quantile(samples, young ? .1 : .2), max = quantile(samples, young ? .9 : .8);
  const middle = quantile(samples, .5);
  const remaining = samples.filter(s => s.minutes > awake);
  // Condition on still being awake; never slide an expired forecast forward.
  if (remaining.length < 4 || new Set(remaining.map(s => s.dayKey)).size < 3 || awake >= max + 20) return insufficient(samples.length);
  const lower = Math.max(awake, min - (young ? 20 : 10));
  const upper = Math.max(max + (young ? 20 : 10), lower + 15);
  if (upper > 360) return insufficient(samples.length);
  const roundUp = (minutes: number) => Math.ceil((last.endMs + minutes * 60000) / 300000) * 300000;
  const earliestStart = roundUp(lower), latestStart = roundUp(upper);
  const variability = (max - min) / Math.max(1, middle);
  const confidence = !young && days >= 10 && recentDays >= 5 && variability < .25 ? "high"
    : !young && days >= 6 && recentDays >= 4 && variability < .5 ? "medium" : "low";
  return { status: "ready", earliestStart, latestStart,
    likelyStart: Math.min(latestStart, Math.max(earliestStart, roundUp(quantile(remaining, .5)))),
    awakeMinutes: Math.floor(awake), typicalAwakeMinutes: { min: Math.floor(min / 5) * 5, max: Math.ceil(max / 5) * 5 },
    confidence, sampleSize: samples.length };
}
