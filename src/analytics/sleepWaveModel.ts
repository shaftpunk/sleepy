import type { DailySleepForecast, ForecastQuality, UpcomingDayForecast } from "./dailySleepForecast";
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
  /** Forecast-engine events, kept apart from recorded sleep. sequenceIndex 1
      is the next sleep (its onset band is forecasts[0]); a wave is present
      only when the engine supports a duration. */
  predicted: PredictedWave[];
  /** Display-only: a long overnight record at the start of the frame is drawn
      on a condensed scale (0..end of the width) so the day ahead gets the
      room. Timestamps are untouched; everything after it shares one linear
      scale. Null when the frame is a single linear scale. */
  compressed: WaveSegment | null;
};
export type PredictedWave = {
  sequenceIndex: number; quality: ForecastQuality; isNext: boolean;
  onset: WaveSegment & { likely: number };
  wave: WaveSegment | null;
};

// A night is a sleep of three hours or more (as in the forecast engine); when
// condensed it takes this share of the chart width.
const NIGHT_MINUTES = 180, NIGHT_SHARE = .16;

export function wavePosition(instant: number, domain: WaveInterval): number {
  return (instant - domain.startMs) / (domain.endMs - domain.startMs);
}

// Height is a styling convention: a readable floor so short naps are legible,
// growing gently and capped; it never represents probability, intensity or
// sleep stages. Exact left/right boundaries encode duration. Each flank is a
// symmetric ease (bell-like for naps, a soft plateau for long sleeps), and
// nothing extends beyond the recorded timestamps.
export function recordedWaveCrest(segment: Pick<WaveSegment, "start" | "end">): number {
  return 150 - Math.min(78, 30 + (segment.end - segment.start) * 640 * .4);
}
export function recordedWavePath(segment: Pick<WaveSegment, "start" | "end">): string {
  const left = segment.start * 640, right = segment.end * 640, width = right - left;
  const shoulder = Math.min(width / 2, 46);
  const crest = recordedWaveCrest(segment);
  // Horizontal tangents at both ends of each flank: (x0,y0) -> (x1,y1).
  const flank = (x0: number, y0: number, x1: number, y1: number) =>
    `C ${x0 + (x1 - x0) * .55} ${y0} ${x0 + (x1 - x0) * .45} ${y1} ${x1} ${y1}`;
  return `M ${left} 150 ${flank(left, 150, left + shoulder, crest)} L ${right - shoulder} ${crest} ${flank(right - shoulder, crest, right, 150)} Z`;
}

/** The model clock shared by Sleep Wave and the History planner: the page clock
    floored to the minute, so geometry updates each minute or on a new record,
    while a just-started/ended interval stays visible within that minute. */
export function waveModelNow(sessions: SleepSession[], active: ActiveSleep | null, now: number): number {
  const latestEnd = sessions.reduce((last, session) => Number.isFinite(session.endMs) ? Math.max(last, session.endMs) : last, 0);
  return Math.max(Math.floor(now / 60000) * 60000, latestEnd <= now ? latestEnd : 0, active && active.startMs <= now ? active.startMs : 0);
}

// Input is already normalized and scoped to the selected baby by the existing
// hook. Display actual records, including long sleeps; don't apply prediction
// plausibility cutoffs to the history visualization. A single compound SVG path
// fills overlapping records once without inventing additional sleep duration.
export function buildSleepWaveModel({ sessions, active, prediction, now, forecast = null }: {
  sessions: SleepSession[]; active: ActiveSleep | null; prediction: NextSleepPrediction; now: number;
  forecast?: DailySleepForecast | null;
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
  // Forecast events accompany an awake onset window or a matching active
  // session forecast. They must remain in order and never in the
  // past, and in order; anything else is dropped rather than repositioned.
  const activeForecast = Boolean(active && forecast?.activeAnchor?.id === active.id && forecast.activeAnchor.startMs === active.startMs && forecast.lastUpdated >= now);
  const predictedNaps = (windows.length || activeForecast) && forecast && (forecast.status === "ready" || forecast.status === "partial")
    ? forecast.predictedNaps.filter((n, i, all) => n.onset.earliestMs >= now && n.onset.earliestMs <= n.onset.typicalMs
      && n.onset.typicalMs <= n.onset.latestMs && (i === 0 || n.onset.typicalMs > all[i - 1].onset.typicalMs)
      && (!n.wakeTime || n.wakeTime.typicalMs > n.onset.typicalMs)) : [];
  const predictedSpans = predictedNaps.flatMap(n => [{ startMs: n.onset.earliestMs, endMs: n.onset.latestMs },
    ...(n.wakeTime ? [{ startMs: n.onset.typicalMs, endMs: n.wakeTime.typicalMs }] : [])]);
  const intervals = [...today, ...(activeInterval ? [activeInterval] : []), ...windows, ...predictedSpans];
  const from = Math.min(morning.getTime(), now, ...intervals.map(s => s.startMs));
  const to = Math.max(evening.getTime(), now, ...intervals.map(s => s.endMs));
  const padding = Math.max(10 * 60000, (to - from) * .025);
  const domain = { startMs: from - padding, endMs: to + padding };
  // Timestamps and display positions are separate: a completed night sleep
  // that began before the daytime frame is condensed to a fixed share of the
  // width when it would otherwise crowd out the day. Nothing else may start
  // inside the condensed stretch, and the rest of the frame stays linear.
  const nightEnd = today.filter(s => s.endMs - s.startMs >= NIGHT_MINUTES * 60000 && s.startMs < morning.getTime())
    .reduce((end, s) => Math.max(end, s.endMs), 0);
  const squeezed = nightEnd > 0 && nightEnd < to
    && (nightEnd - domain.startMs) / (domain.endMs - domain.startMs) > NIGHT_SHARE * 1.4
    && [...(activeInterval ? [activeInterval] : []), ...windows, ...predictedSpans].every(s => s.startMs >= nightEnd);
  const position = (instant: number) => !squeezed ? wavePosition(instant, domain)
    : instant <= nightEnd ? (instant - domain.startMs) / (nightEnd - domain.startMs) * NIGHT_SHARE
    : NIGHT_SHARE + (instant - nightEnd) / (domain.endMs - nightEnd) * (1 - NIGHT_SHARE);
  const segment = ({ startMs, endMs }: WaveInterval): WaveSegment => ({ startMs, endMs, start: position(startMs), end: position(endMs) });
  const tickFrom = squeezed ? nightEnd : from;
  // An ordinary single-day frame gets a tick every third local hour (06, 09 ...).
  // Otherwise up to four elapsed-time ticks, with interior ticks rounded to
  // local hours; date/offset labels use just two anchors to avoid collisions.
  const crossesOffset = new Date(from).getTimezoneOffset() !== new Date(to).getTimezoneOffset();
  const threeHourly: number[] = [];
  if (!crossesOffset && sameDay(tickFrom, now) && sameDay(to, now)) {
    const tick = new Date(tickFrom); tick.setHours(Math.ceil((tick.getHours() * 60 + tick.getMinutes()) / 180) * 3, 0, 0, 0);
    for (; tick.getTime() <= to; tick.setHours(tick.getHours() + 3)) threeHourly.push(tick.getTime());
  }
  const tickInstants = threeHourly.length >= 3 ? threeHourly : [0, 1 / 3, 2 / 3, 1].map(fraction => {
    if (fraction === 0) return from;
    if (fraction === 1) return to;
    const date = new Date(from + fraction * (to - from)); date.setMinutes(0, 0, 0); return date.getTime();
  }).filter((instant, i, all) => instant >= from && all.indexOf(instant) === i);
  const needsContext = crossesOffset || tickInstants.some(instant => !sameDay(instant, now));
  const readableTicks = needsContext ? [tickInstants[0], tickInstants[tickInstants.length - 1]] : tickInstants;
  const ticks = readableTicks.map(instant => ({ instant, position: position(instant),
    showDate: !sameDay(instant, now), showOffset: crossesOffset }));
  const lastCompleted = valid.reduce<WaveInterval | null>((last, s) => !last || s.endMs > last.endMs ? s : last, null);
  return { status: sleeping ? "sleeping" : windows.length ? "ready" : "insufficient_data", domain,
    recorded: today.map(segment), active: activeInterval ? segment(activeInterval) : null,
    forecasts: windows.map(w => ({ ...segment(w), likely: position(Math.max(w.startMs, Math.min(w.endMs, w.likelyMs ?? (w.startMs + w.endMs) / 2))) })),
    now: position(now), ticks, lastCompleted,
    compressed: squeezed ? segment({ startMs: domain.startMs, endMs: nightEnd }) : null,
    predicted: predictedNaps.map(n => ({ sequenceIndex: n.sequenceIndex, quality: n.quality, isNext: n.isNext,
      onset: { ...segment({ startMs: n.onset.earliestMs, endMs: n.onset.latestMs }), likely: position(n.onset.typicalMs) },
      wave: n.wakeTime ? segment({ startMs: n.onset.typicalMs, endMs: n.wakeTime.typicalMs }) : null })) };
}

/** Display-only expansion; neighbors and domain edges take priority over minimum width. */
export function recordedDisplaySegments(segments: WaveSegment[], chartWidth: number, neighbors: WaveSegment[] = []): WaveSegment[] {
  if (!(chartWidth > 0)) return segments;
  const all = [...segments, ...neighbors];
  return segments.map(segment => {
    const center = (segment.start + segment.end) / 2;
    let radius = Math.max((segment.end - segment.start) / 2, 6 / chartWidth);
    const left = Math.max(0, ...all.filter(s => s !== segment && s.end <= segment.start).map(s => (s.end + segment.start) / 2));
    const right = Math.min(1, ...all.filter(s => s !== segment && s.start >= segment.end).map(s => (segment.end + s.start) / 2));
    radius = Math.max((segment.end - segment.start) / 2, Math.min(radius, center - left, right - center));
    return { ...segment, start: center - radius, end: center + radius };
  });
}

/** Preliminary upcoming-day timeline: its own explicit date and axis, never
    merged into the current day's chart. Positions use the same instant-based
    geometry as the main chart. */
export type UpcomingDayWaveModel = {
  targetDayStartMs: number;
  domain: WaveInterval;
  wake: (WaveSegment & { likely: number }) | null;
  naps: PredictedWave[];
  ticks: { instant: number; position: number }[];
};
export function buildUpcomingDayWaveModel(forecast: UpcomingDayForecast | null): UpcomingDayWaveModel | null {
  if (!forecast || forecast.status !== "ready" || forecast.targetDayStartMs === null || !forecast.morningWake) return null;
  const day = new Date(forecast.targetDayStartMs);
  const clock = (hour: number) => { const d = new Date(day); d.setHours(hour, 0, 0, 0); return d.getTime(); };
  const spans = [forecast.morningWake, ...forecast.predictedNaps.flatMap(n => [n.onset, ...(n.wakeTime ? [n.wakeTime] : [])])];
  const from = Math.min(clock(5), ...spans.map(s => s.earliestMs));
  const to = Math.max(clock(19), ...spans.map(s => s.latestMs));
  const padding = 20 * 60000, domain = { startMs: from - padding, endMs: to + padding };
  const position = (instant: number) => wavePosition(instant, domain);
  const segment = ({ startMs, endMs }: WaveInterval): WaveSegment => ({ startMs, endMs, start: position(startMs), end: position(endMs) });
  const ticks = [6, 10, 14, 18].map(clock).filter(t => t >= domain.startMs && t <= domain.endMs).map(instant => ({ instant, position: position(instant) }));
  return { targetDayStartMs: forecast.targetDayStartMs, domain, ticks,
    wake: { ...segment({ startMs: forecast.morningWake.earliestMs, endMs: forecast.morningWake.latestMs }), likely: position(forecast.morningWake.typicalMs) },
    naps: forecast.predictedNaps.map(n => ({ sequenceIndex: n.sequenceIndex, quality: n.quality, isNext: n.isNext,
      onset: { ...segment({ startMs: n.onset.earliestMs, endMs: n.onset.latestMs }), likely: position(n.onset.typicalMs) },
      wave: n.wakeTime ? segment({ startMs: n.onset.typicalMs, endMs: n.wakeTime.typicalMs }) : null })) };
}
