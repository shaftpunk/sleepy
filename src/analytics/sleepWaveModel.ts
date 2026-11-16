import type { NextSleepPrediction } from "./nextSleep";
import { sameDay, startOfLocalDay } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

export type WaveInterval = { startMs: number; endMs: number };
export type WaveForecast = WaveInterval & { likelyMs?: number };
export type WaveSegment = WaveInterval & { start: number; end: number };
export type SleepWaveModel = {
  status: NextSleepPrediction["status"];
  domain: WaveInterval;
  recorded: WaveSegment[];
  active: WaveSegment | null;
  forecasts: (WaveSegment & { likely: number })[];
  now: number;
  ticks: { instant: number; position: number; showDate: boolean; showOffset: boolean }[];
  lastCompleted: WaveInterval | null;
};

export function wavePosition(instant: number, domain: WaveInterval): number {
  return (instant - domain.startMs) / (domain.endMs - domain.startMs);
}

// Height is a styling convention, capped and softened for narrow intervals;
// it never represents probability, intensity or sleep stages. Exact left/right
// boundaries encode duration. Nothing extends beyond the recorded timestamps.
export function recordedWavePath(segment: Pick<WaveSegment, "start" | "end">): string {
  const left = segment.start * 640, right = segment.end * 640;
  const shoulder = Math.min((right - left) / 2, 42);
  const crest = 150 - Math.min(62, (right - left) * .5);
  return `M ${left} 150 C ${left + shoulder / 2} 150 ${left + shoulder / 2} ${crest} ${left + shoulder} ${crest} L ${right - shoulder} ${crest} C ${right - shoulder / 2} ${crest} ${right - shoulder / 2} 150 ${right} 150 Z`;
}

// Input is already normalized and scoped to the selected baby by the existing
// hook. Display actual records, including long sleeps; don't apply prediction
// plausibility cutoffs to the history visualization. A single compound SVG path
// fills overlapping records once without inventing additional sleep duration.
export function buildSleepWaveModel({ sessions, active, prediction, now }: {
  sessions: SleepSession[]; active: ActiveSleep | null; prediction: NextSleepPrediction; now: number;
}): SleepWaveModel {
  const dayStart = startOfLocalDay(now);
  const tomorrow = new Date(dayStart); tomorrow.setDate(tomorrow.getDate() + 1);
  const valid = sessions.filter(s => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) &&
    s.endMs > s.startMs && s.endMs <= now);
  const today = valid.filter(s => s.endMs > dayStart && s.startMs < tomorrow.getTime());
  const activeInterval = active && Number.isFinite(active.startMs) && active.startMs <= now
    ? { startMs: active.startMs, endMs: now } : null;
  const sleeping = Boolean(activeInterval) || prediction.status === "sleeping";
  const windows: WaveForecast[] = !sleeping && prediction.status === "ready" &&
    Number.isFinite(prediction.earliestStart) && Number.isFinite(prediction.latestStart) &&
    prediction.earliestStart! >= now && prediction.latestStart! > prediction.earliestStart!
    ? [{ startMs: prediction.earliestStart!, endMs: prediction.latestStart!, likelyMs: prediction.likelyStart }] : [];
  // Practical daytime frame, expanded to include full overnight records,
  // current sleep, now, and the entire next onset window. No silent clipping.
  const morning = new Date(dayStart); morning.setHours(6);
  const evening = new Date(dayStart); evening.setHours(21);
  const intervals = [...today, ...(activeInterval ? [activeInterval] : []), ...windows];
  const from = Math.min(morning.getTime(), now, ...intervals.map(s => s.startMs));
  const to = Math.max(evening.getTime(), now, ...intervals.map(s => s.endMs));
  const padding = Math.max(10 * 60000, (to - from) * .025);
  const domain = { startMs: from - padding, endMs: to + padding };
  const position = (instant: number) => wavePosition(instant, domain);
  const segment = ({ startMs, endMs }: WaveInterval): WaveSegment => ({ startMs, endMs, start: position(startMs), end: position(endMs) });
  // Up to four elapsed-time ticks, with interior ticks rounded to local hours.
  // Context-heavy date/offset labels use just two anchors to avoid collisions.
  const tickInstants = [0, 1 / 3, 2 / 3, 1].map(fraction => {
    if (fraction === 0) return from;
    if (fraction === 1) return to;
    const date = new Date(from + fraction * (to - from)); date.setMinutes(0, 0, 0); return date.getTime();
  }).filter((instant, i, all) => instant >= from && all.indexOf(instant) === i);
  const crossesOffset = new Date(from).getTimezoneOffset() !== new Date(to).getTimezoneOffset();
  const needsContext = crossesOffset || tickInstants.some(instant => !sameDay(instant, now));
  const readableTicks = needsContext ? [tickInstants[0], tickInstants[tickInstants.length - 1]] : tickInstants;
  const ticks = readableTicks.map(instant => ({ instant, position: position(instant),
    showDate: !sameDay(instant, now), showOffset: crossesOffset }));
  const lastCompleted = valid.reduce<WaveInterval | null>((last, s) => !last || s.endMs > last.endMs ? s : last, null);
  return { status: sleeping ? "sleeping" : windows.length ? "ready" : "insufficient_data", domain,
    recorded: today.map(segment), active: activeInterval ? segment(activeInterval) : null,
    forecasts: windows.map(w => ({ ...segment(w), likely: position(Math.max(w.startMs, Math.min(w.endMs, w.likelyMs ?? (w.startMs + w.endMs) / 2))) })),
    now: position(now), ticks, lastCompleted };
}
