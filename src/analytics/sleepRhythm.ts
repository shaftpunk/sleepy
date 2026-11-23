import { clockMinute, dayKeyOf, lastNLocalDayKeys, minuteBefore, offsetTransitions, splitIntervalByLocalDay, startOfLocalDay } from "./time";
import type { ActiveSleep, SleepSession } from "./types";

export const RHYTHM_PAGE_DAYS = 7;
export const RHYTHM_MAX_DAYS = 105;

export type RhythmBlock = {
  id: string;
  startMs: number;
  endMs: number;
  endsAtMidnight: boolean;
  active: boolean;
  pieces: { startMinute: number; endMinute: number }[];
};
export type RhythmDay = { dayKey: string; blocks: RhythmBlock[] };

export function sleepRhythmStart(now: number) {
  const date = new Date(startOfLocalDay(now));
  date.setDate(date.getDate() - (RHYTHM_MAX_DAYS - 1));
  return date.getTime();
}

export function visibleRhythmDays(rows: RhythmDay[], requestedDays: number) {
  return rows.slice(0, Math.min(requestedDays, RHYTHM_MAX_DAYS));
}

export function buildSleepRhythm(sessions: SleepSession[], active: ActiveSleep | null, now: number): RhythmDay[] {
  const limit = sleepRhythmStart(now);
  const today = startOfLocalDay(now);
  const blocksByDay = new Map<string, RhythmBlock[]>();
  const transitionsByDay = new Map<string, number[]>();
  const intervals = sessions.map(session => ({ ...session, active: false }));
  const seen = new Set<string>();
  const sources = active ? [...intervals, { ...active, startMs: Math.max(active.startMs, today), endMs: now, active: true }] : intervals;
  for (const interval of sources) {
    const start = Math.max(limit, interval.startMs);
    const end = Math.min(now, interval.endMs);
    if (start >= end) continue;
    const identity = [start, end, interval.active].join(":");
    if (seen.has(identity)) continue;
    seen.add(identity);
    for (const { dayKey, startMs, endMs, midnightEndMs } of splitIntervalByLocalDay(start, end)) {
      const endsAtMidnight = endMs === midnightEndMs;
      let transitions = transitionsByDay.get(dayKey);
      if (!transitions) {
        transitions = offsetTransitions(startOfLocalDay(startMs), midnightEndMs);
        transitionsByDay.set(dayKey, transitions);
      }
      const cuts = [startMs, ...transitions.filter(time => time > startMs && time < endMs), endMs];
      const pieces = cuts.slice(0, -1).flatMap((time, index) => {
        const startMinute = clockMinute(time);
        const endMinute = cuts[index + 1] === midnightEndMs ? 1440 : minuteBefore(cuts[index + 1]);
        return endMinute > startMinute ? [{ startMinute, endMinute }] : [];
      });
      const block = { id: interval.id, startMs, endMs, endsAtMidnight, active: interval.active, pieces };
      const blocks = blocksByDay.get(dayKey) ?? [];
      blocks.push(block);
      blocksByDay.set(dayKey, blocks);
    }
  }

  const days = lastNLocalDayKeys(now, RHYTHM_MAX_DAYS).reverse();
  const oldest = [...days].reverse().find(key => blocksByDay.has(key)) ?? dayKeyOf(today);
  const count = Math.max(RHYTHM_PAGE_DAYS, days.indexOf(oldest) + 1);
  return days.slice(0, count).map(dayKey => ({ dayKey, blocks: blocksByDay.get(dayKey) ?? [] }));
}
