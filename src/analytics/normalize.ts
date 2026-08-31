import type {
  ActiveSleep,
  FeedEvent,
  RawFeedRow,
  RawSleepRow,
  SleepSession,
} from "./types";

function parseRate(raw: string | null): number | null {
  if (raw == null) return null;

  const value = Number(raw);

  if (Number.isNaN(value) || value <= 0) return null;

  return value;
}

// Splits raw rows into completed sessions (used by all analytics) and the
// currently-active sleep, if any (endtime IS NULL — excluded from analytics,
// only used for live-timer/strip display). If more than one open row exists
// (shouldn't happen, but the data model doesn't forbid it) the most recently
// started one wins.
export function normalizeSleepRows(rows: RawSleepRow[]): {
  sessions: SleepSession[];
  active: ActiveSleep | null;
} {
  const sessions: SleepSession[] = [];
  let active: ActiveSleep | null = null;

  for (const row of rows) {
    const startMs = Date.parse(row.starttime);

    if (row.endtime == null) {
      if (!Number.isNaN(startMs) && (!active || startMs > active.startMs)) {
        active = { id: row.id, startMs };
      }
      continue;
    }

    const endMs = Date.parse(row.endtime);

    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      continue;
    }

    const durationMin =
      row.durationminutes ?? Math.round((endMs - startMs) / 60000);

    sessions.push({
      id: row.id,
      startMs,
      endMs,
      durationMin,
      rate: parseRate(row.rate),
      note: row.note ?? null,
      sleepTypeRaw: row.sleep_type,
    });
  }

  sessions.sort((a, b) => a.startMs - b.startMs);

  return { sessions, active };
}

// Feed rows keep any in-progress row (endtime null) — every feed stat in the
// spec keys off START_TS only, unlike sleep where duration/coverage math
// requires a known endMs.
export function normalizeFeedRows(rows: RawFeedRow[]): FeedEvent[] {
  const feeds: FeedEvent[] = [];

  for (const row of rows) {
    const startMs = Date.parse(row.starttime);
    if (Number.isNaN(startMs)) continue;

    const endMs = row.endtime != null ? Date.parse(row.endtime) : null;

    feeds.push({
      id: row.id,
      startMs,
      endMs: endMs != null && !Number.isNaN(endMs) ? endMs : null,
      durationMin: row.durationminutes,
      feedType: row.feedtype,
      side: row.side,
      amountMl: row.amountml,
      note: row.note,
    });
  }

  feeds.sort((a, b) => a.startMs - b.startMs);

  return feeds;
}
