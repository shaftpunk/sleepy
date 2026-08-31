import { average, startOfLocalDay } from "./time";
import type { ActiveSleep, FeedEvent, SleepSession } from "./types";

export type TodayTotals = {
  totalMinutes: number;
  sessionCount: number;
  avgRating: number | null;
};

// Sessions are attributed to "today" by START_TS only; the full duration is
// counted even if a session extends past local midnight (not clipped).
export function computeTodayTotals(
  sessions: SleepSession[],
  now: number
): TodayTotals {
  const todayStart = startOfLocalDay(now);
  const todaySessions = sessions.filter((s) => s.startMs >= todayStart && s.startMs <= now);

  const totalMinutes = todaySessions.reduce((sum, s) => sum + s.durationMin, 0);
  const rated = todaySessions.filter((s) => s.rate != null).map((s) => s.rate as number);

  return {
    totalMinutes,
    sessionCount: todaySessions.length,
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
const STRIP_CELL_COUNT = 72; // 12h / 10min

// A cell counts as "sleep" if >=50% of its span is covered by any completed
// session or the currently-active one.
export function computeSleepStrip(
  sessions: SleepSession[],
  active: ActiveSleep | null,
  now: number
): SleepStripCell[] {
  const cellMs = STRIP_CELL_MINUTES * 60000;
  const windowStart = now - STRIP_CELL_COUNT * cellMs;

  const intervals: { start: number; end: number }[] = sessions
    .filter((s) => s.endMs > windowStart && s.startMs < now)
    .map((s) => ({ start: s.startMs, end: s.endMs }));

  if (active && active.startMs < now) {
    intervals.push({ start: active.startMs, end: now });
  }

  const cells: SleepStripCell[] = [];

  for (let i = 0; i < STRIP_CELL_COUNT; i++) {
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
