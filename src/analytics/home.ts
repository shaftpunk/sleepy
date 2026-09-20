import { average, dayKeyOf, splitMinutesByLocalDay, startOfLocalDay } from "./time";
import type { ActiveSleep, FeedEvent, SleepSession } from "./types";

export type TodayTotals = {
  totalMinutes: number;
  sessionCount: number;
  avgRating: number | null;
};

// totalMinutes only counts the portion of each session that actually falls
// on today's calendar date - an overnight session that started yesterday at
// 22:00 and ended today at 06:00 contributes just those 6 morning hours, and
// a session that starts today but is still ongoing past midnight tomorrow
// would (once completed) contribute only its pre-midnight portion. This
// requires looking at any session overlapping today at all, not just ones
// that started today.
//
// sessionCount/avgRating stay keyed to sessions that STARTED today - a
// discrete "how many sleeps began today" tally isn't something that makes
// sense to split across a midnight crossing.
export function computeTodayTotals(
  sessions: SleepSession[],
  now: number
): TodayTotals {
  const todayStart = startOfLocalDay(now);
  const todayKey = dayKeyOf(now);

  const overlappingToday = sessions.filter((s) => s.endMs > todayStart && s.startMs <= now);

  let totalMinutes = 0;
  for (const s of overlappingToday) {
    for (const frag of splitMinutesByLocalDay(s.startMs, Math.min(s.endMs, now))) {
      if (frag.dayKey === todayKey) totalMinutes += frag.minutes;
    }
  }

  const startedToday = sessions.filter((s) => s.startMs >= todayStart && s.startMs <= now);
  const rated = startedToday.filter((s) => s.rate != null).map((s) => s.rate as number);

  return {
    totalMinutes: Math.round(totalMinutes),
    sessionCount: startedToday.length,
    avgRating: rated.length ? Math.round(average(rated) * 10) / 10 : null,
  };
}

export type NextSleepHint =
  | { kind: "predicted"; predictedTs: number }
  | { kind: "about-usual" }
  | { kind: "longer-than-usual"; overMinutes: number };

export function computeNextSleepHint(input: {
  lastSessionEndMs: number | null;
  isCurrentlyAsleep: boolean;
  wakeWindowCount: number;
  medianWakeWindowMinutes: number | null;
  now: number;
}): NextSleepHint | null {
  const {
    lastSessionEndMs,
    isCurrentlyAsleep,
    wakeWindowCount,
    medianWakeWindowMinutes,
    now,
  } = input;

  if (
    isCurrentlyAsleep ||
    lastSessionEndMs == null ||
    wakeWindowCount < 5 ||
    medianWakeWindowMinutes == null
  ) {
    return null;
  }

  const awakeMinutes = (now - lastSessionEndMs) / 60000;
  const diff = awakeMinutes - medianWakeWindowMinutes;

  if (diff < -5) {
    return {
      kind: "predicted",
      predictedTs: lastSessionEndMs + medianWakeWindowMinutes * 60000,
    };
  }

  if (diff <= 60) {
    return { kind: "about-usual" };
  }

  return { kind: "longer-than-usual", overMinutes: Math.round(diff) };
}

export type SleepStripCell = {
  startMs: number;
  endMs: number;
  isSleep: boolean;
};

const STRIP_CELL_MINUTES = 10;
const STRIP_DEFAULT_WINDOW_HOURS = 12;

// A cell counts as "sleep" if >=50% of its span is covered by any completed
// session or the currently-active one. `windowHours` defaults to 12 (the
// Home screen's strip); src/analytics/sleepClock.ts reuses this with 24h.
export function computeSleepStrip(
  sessions: SleepSession[],
  active: ActiveSleep | null,
  now: number,
  windowHours: number = STRIP_DEFAULT_WINDOW_HOURS
): SleepStripCell[] {
  const cellMs = STRIP_CELL_MINUTES * 60000;
  const cellCount = Math.round((windowHours * 60) / STRIP_CELL_MINUTES);
  const windowStart = now - cellCount * cellMs;

  const intervals: { start: number; end: number }[] = sessions
    .filter((s) => s.endMs > windowStart && s.startMs < now)
    .map((s) => ({ start: s.startMs, end: s.endMs }));

  if (active && active.startMs < now) {
    intervals.push({ start: active.startMs, end: now });
  }

  const cells: SleepStripCell[] = [];

  for (let i = 0; i < cellCount; i++) {
    const cellStart = windowStart + i * cellMs;
    const cellEnd = cellStart + cellMs;

    let covered = 0;
    for (const interval of intervals) {
      const overlapStart = Math.max(cellStart, interval.start);
      const overlapEnd = Math.min(cellEnd, interval.end);
      if (overlapEnd > overlapStart) covered += overlapEnd - overlapStart;
    }

    cells.push({
      startMs: cellStart,
      endMs: cellEnd,
      isSleep: covered >= cellMs * 0.5,
    });
  }

  return cells;
}

// Opposite side of the most recent breast feed; null if there's no breast
// feed, or the last one used "both".
export function computeNextFeedSide(feeds: FeedEvent[]): "left" | "right" | null {
  const breastFeeds = feeds.filter((f) => f.feedType === "breast" && f.side != null);
  if (breastFeeds.length === 0) return null;

  const last = breastFeeds.reduce((a, b) => (b.startMs > a.startMs ? b : a));

  if (last.side === "left") return "right";
  if (last.side === "right") return "left";

  return null;
}
