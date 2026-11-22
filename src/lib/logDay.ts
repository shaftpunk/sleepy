import { parseLocalDateOnly } from "../analytics/localDate";
import type { SleepRecord } from "../services/sleepService";
import type { FeedRecord } from "../services/feedService";
import type { DiaperChange } from "../services/diaperService";

export function localDayKey(date: Date): string {
  return [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function shiftLocalDay(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function logDayBounds(value: string | null, today: string) {
  const start = parseLocalDateOnly(value) ?? parseLocalDateOnly(today)!;
  return { start, end: shiftLocalDay(start, 1), key: localDayKey(start) };
}

export function logTimeline(sleeps: SleepRecord[], feeds: FeedRecord[], diapers: DiaperChange[], dayStart: number, dayEnd: number) {
  return [
    ...sleeps.map(record => {
      const end = record.endtime ? Date.parse(record.endtime) : NaN;
      const time = end >= dayStart && end < dayEnd ? end : Math.max(dayStart, Date.parse(record.starttime));
      return { kind: "sleep" as const, record, time };
    }),
    ...feeds.map(record => ({ kind: "feed" as const, record, time: Date.parse(record.starttime) })),
    ...diapers.map(record => ({ kind: "diaper" as const, record, time: Date.parse(record.changed_at) })),
  ].sort((a, b) => b.time - a.time || a.kind.localeCompare(b.kind, "en") || a.record.id.localeCompare(b.record.id, "en"));
}
