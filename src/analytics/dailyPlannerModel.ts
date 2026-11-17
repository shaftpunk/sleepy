import type { DailySleepForecast, UpcomingDayForecast } from "./dailySleepForecast";
import type { NextSleepPrediction } from "./nextSleep";
import { buildSleepWaveModel, buildUpcomingDayWaveModel, waveModelNow } from "./sleepWaveModel";
import { sameDay, startOfLocalDay } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

/* History's vertical daily planner. It is a second *view* of the Sleep Wave
   model, not a second forecast: every recorded, active and predicted event is
   taken from buildSleepWaveModel / buildUpcomingDayWaveModel, which apply the
   same filtering to the same forecast output, so both views show identical
   windows. Only the geometry differs: one linear vertical scale (equal
   durations get equal height), with no overnight compression. */

export const PLANNER_FRAME = {
  morningHour: 6,
  eveningHour: 21,
  /** A sleep carried in from the previous day shows at most this much before its end. */
  carryInMinutes: 60,
  /** Gaps between actual sleep shorter than this get no awake label. */
  minAwakeLabelMinutes: 30,
};

export type PlannerEventKind = "recorded" | "active" | "next" | "later" | "wake";
export type PlannerEvent = {
  key: string;
  kind: PlannerEventKind;
  /** True instants. Recorded/active: the sleep. Forecasts: the onset (or wake) window. */
  startMs: number;
  endMs: number;
  likelyMs?: number;
  /** Estimated sleep, only when the forecast supplies a wake time. */
  sleep: { startMs: number; endMs: number } | null;
  sessionId?: string;
  sequenceIndex?: number;
  /** Display geometry in minutes from the frame start, clipped to the frame. */
  top: number;
  height: number;
  clippedStart: boolean;
  clippedEnd: boolean;
  lane: number;
  lanes: number;
};
export type PlannerAwake = { key: string; startMs: number; endMs: number; top: number; height: number; untilNow: boolean };
export type PlannerDay = {
  key: string;
  /** "today": the current calendar day. "upcoming": a preliminary forecast for a later date. */
  mode: "today" | "upcoming";
  dayStartMs: number;
  frameStartMs: number;
  frameEndMs: number;
  /** Frame length in minutes (elapsed time, so DST days are 23 or 25 hours long). */
  minutes: number;
  hours: { instant: number; top: number }[];
  events: PlannerEvent[];
  awake: PlannerAwake[];
  /** Minutes from the frame start, or null when now is not on this day. */
  now: number | null;
  preliminary: boolean;
  /** No forecast to show (learning, or insufficient evidence for the coming day). */
  noForecast: boolean;
};
export type DailyPlannerModel = { status: "ready" | "sleeping" | "insufficient_data"; night: boolean; days: PlannerDay[] };

const minute = 60000;
const atHour = (dayStartMs: number, hour: number) => { const d = new Date(dayStartMs); d.setHours(hour, 0, 0, 0); return d.getTime(); };
const nextDayStart = (dayStartMs: number) => { const d = new Date(dayStartMs); d.setDate(d.getDate() + 1); return d.getTime(); };
// Subtract the minutes instead of setMinutes(0): on the autumn DST night
// setMinutes would snap the repeated hour back to its first occurrence.
const floorHour = (ms: number) => { const d = new Date(ms); return ms - ((d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds()); };
const ceilHour = (ms: number) => { const f = floorHour(ms); return f === ms ? ms : floorHour(f + 61 * minute); };

type RawEvent = Omit<PlannerEvent, "top" | "height" | "clippedStart" | "clippedEnd" | "lane" | "lanes">;

function layoutDay({ key, mode, dayStartMs, raw, nowMs, preliminary, noForecast }: {
  key: string; mode: PlannerDay["mode"]; dayStartMs: number; raw: RawEvent[]; nowMs: number | null; preliminary: boolean; noForecast: boolean;
}): PlannerDay {
  const dayEnd = nextDayStart(dayStartMs);
  const end = (e: RawEvent) => Math.max(e.endMs, e.sleep?.endMs ?? 0);
  // A sleep carried in from the previous day is shown from shortly before its
  // end; its label keeps the true start. Everything else widens the frame.
  const anchors = raw.map(e => e.startMs >= dayStartMs ? e.startMs : Math.max(dayStartMs, end(e) - PLANNER_FRAME.carryInMinutes * minute));
  const frameStartMs = Math.max(dayStartMs, floorHour(Math.min(atHour(dayStartMs, PLANNER_FRAME.morningHour), ...(nowMs !== null ? [nowMs] : []), ...anchors)));
  const frameEndMs = Math.min(dayEnd, ceilHour(Math.max(atHour(dayStartMs, PLANNER_FRAME.eveningHour), ...(nowMs !== null ? [nowMs] : []), ...raw.map(end))));
  const at = (ms: number) => (Math.min(frameEndMs, Math.max(frameStartMs, ms)) - frameStartMs) / minute;

  const events: PlannerEvent[] = raw
    .filter(e => end(e) > frameStartMs && e.startMs < frameEndMs)
    .map(e => ({ ...e, top: at(e.startMs), height: at(end(e)) - at(e.startMs),
      clippedStart: e.startMs < frameStartMs, clippedEnd: end(e) > frameEndMs, lane: 0, lanes: 1 }))
    .sort((a, b) => a.top - b.top || a.height - b.height);
  // Overlapping events (e.g. a later nap's onset window inside the previous
  // estimated sleep) sit side by side instead of on top of each other; their
  // vertical position always stays true to time.
  for (let i = 0; i < events.length;) {
    let j = i + 1, bottom = events[i].top + events[i].height;
    while (j < events.length && events[j].top < bottom) { bottom = Math.max(bottom, events[j].top + events[j].height); j++; }
    const cluster = events.slice(i, j), laneEnds: number[] = [];
    for (const e of cluster) {
      const free = laneEnds.findIndex(laneEnd => laneEnd <= e.top);
      e.lane = free >= 0 ? free : laneEnds.length;
      laneEnds[e.lane] = e.top + e.height;
    }
    for (const e of cluster) e.lanes = laneEnds.length;
    i = j;
  }

  // Awake time only between actual sleep (and from the last wake-up to now);
  // never around forecasts, and nothing is inferred before the first record.
  const actual = events.filter(e => e.kind === "recorded" || e.kind === "active").sort((a, b) => a.startMs - b.startMs);
  const awake: PlannerAwake[] = [];
  actual.forEach((e, i) => {
    const next = actual[i + 1];
    const until = next ? next.startMs : e.kind === "recorded" && nowMs !== null && !actual.some(a => a.kind === "active") ? nowMs : null;
    if (until === null || until - e.endMs < PLANNER_FRAME.minAwakeLabelMinutes * minute) return;
    awake.push({ key: `awake-${e.key}`, startMs: e.endMs, endMs: until, top: at(e.endMs), height: at(until) - at(e.endMs), untilNow: !next });
  });

  const hours: PlannerDay["hours"] = [];
  for (let instant = ceilHour(frameStartMs); instant <= frameEndMs; instant = floorHour(instant + 61 * minute)) hours.push({ instant, top: at(instant) });
  return { key, mode, dayStartMs, frameStartMs, frameEndMs, minutes: (frameEndMs - frameStartMs) / minute, hours, events, awake,
    now: nowMs !== null && nowMs >= frameStartMs && nowMs <= frameEndMs ? at(nowMs) : null, preliminary, noForecast };
}

export function buildDailyPlannerModel({ sessions, active, prediction, forecast = null, upcoming = null, now }: {
  sessions: SleepSession[]; active: ActiveSleep | null; prediction: NextSleepPrediction;
  forecast?: DailySleepForecast | null; upcoming?: UpcomingDayForecast | null; now: number;
}): DailyPlannerModel {
  const clock = waveModelNow(sessions, active, now);
  const night = Boolean(upcoming && upcoming.status !== "not_applicable");
  // Same call as Sleep Wave on Home: at night the remaining-day forecast is
  // replaced by the coming-day forecast, never shown alongside it.
  const wave = buildSleepWaveModel({ sessions, active, prediction, forecast: night ? null : forecast, now: clock });
  const sessionId = (startMs: number, endMs: number) => sessions.find(s => s.startMs === startMs && s.endMs === endMs)?.id;
  const actual: RawEvent[] = [
    ...wave.recorded.map((s, i) => ({ key: `r-${s.startMs}-${i}`, kind: "recorded" as const, startMs: s.startMs, endMs: s.endMs, sleep: null, sessionId: sessionId(s.startMs, s.endMs) })),
    ...(wave.active && active ? [{ key: `a-${active.id}`, kind: "active" as const, startMs: wave.active.startMs, endMs: wave.active.endMs, sleep: null, sessionId: active.id }] : []),
  ];
  const nextSleep = wave.predicted.find(p => p.isNext)?.wave ?? null;
  const predicted: RawEvent[] = [
    ...wave.forecasts.map((w, i) => ({ key: `n-${i}`, kind: "next" as const, startMs: w.startMs, endMs: w.endMs, likelyMs: prediction.likelyStart,
      sleep: nextSleep ? { startMs: nextSleep.startMs, endMs: nextSleep.endMs } : null, sequenceIndex: 1 })),
    ...wave.predicted.filter(p => !p.isNext).map(p => ({ key: `p-${p.sequenceIndex}`, kind: "later" as const, startMs: p.onset.startMs, endMs: p.onset.endMs,
      likelyMs: forecast?.predictedNaps.find(n => n.sequenceIndex === p.sequenceIndex)?.onset.typicalMs,
      sleep: p.wave ? { startMs: p.wave.startMs, endMs: p.wave.endMs } : null, sequenceIndex: p.sequenceIndex })),
  ];
  const todayStart = startOfLocalDay(clock);
  const days: PlannerDay[] = [];
  if (!night) {
    days.push(layoutDay({ key: `day-${todayStart}`, mode: "today", dayStartMs: todayStart, raw: [...actual, ...predicted], nowMs: clock,
      preliminary: false, noForecast: wave.status === "insufficient_data" }));
  } else {
    const coming = buildUpcomingDayWaveModel(upcoming);
    const targetStart = upcoming?.targetDayStartMs ?? null;
    const forecastEvents: RawEvent[] = coming ? [
      { key: "wake", kind: "wake", startMs: coming.wake!.startMs, endMs: coming.wake!.endMs, likelyMs: upcoming!.morningWake!.typicalMs, sleep: null },
      ...upcoming!.predictedNaps.map(n => ({ key: `u-${n.sequenceIndex}`, kind: "later" as const, startMs: n.onset.earliestMs, endMs: n.onset.latestMs,
        likelyMs: n.onset.typicalMs, sleep: n.wakeTime ? { startMs: n.onset.typicalMs, endMs: n.wakeTime.typicalMs } : null, sequenceIndex: n.sequenceIndex })),
    ] : [];
    if (targetStart !== null && sameDay(targetStart, clock)) {
      // After midnight: the coming day is today, so one calendar, marked preliminary.
      days.push(layoutDay({ key: `day-${todayStart}`, mode: "upcoming", dayStartMs: todayStart, raw: [...actual, ...forecastEvents], nowMs: clock,
        preliminary: true, noForecast: !coming }));
    } else {
      // Before midnight: today's actual sleep, then the coming day on its own
      // dated calendar. The two are never drawn on one axis.
      days.push(layoutDay({ key: `day-${todayStart}`, mode: "today", dayStartMs: todayStart, raw: actual, nowMs: clock, preliminary: false, noForecast: false }));
      if (targetStart !== null) days.push(layoutDay({ key: `day-${targetStart}`, mode: "upcoming", dayStartMs: targetStart, raw: forecastEvents, nowMs: null,
        preliminary: true, noForecast: !coming }));
    }
  }
  return { status: wave.status, night, days };
}
