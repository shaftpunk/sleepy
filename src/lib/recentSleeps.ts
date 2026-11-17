import { sameDay } from "../analytics/time";
import { LOCALES, translate, type Language } from "../i18n";
import type { SleepRecord } from "../services/sleepService";

export const ROLLING_DAY_MS = 24 * 60 * 60 * 1000;

/** Completed sleep that overlaps the rolling 24 hours ending at `now`
    (not the calendar day), newest first. Overnight sessions that started more
    than 24 hours ago but ended inside the window are included. */
export function sleepsInLast24Hours(rows: SleepRecord[], now: number): SleepRecord[] {
  return rows
    .filter(row => {
      const start = Date.parse(row.starttime), end = row.endtime ? Date.parse(row.endtime) : NaN;
      return !row.deleted_at && Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now - ROLLING_DAY_MS;
    })
    .sort((a, b) => Date.parse(b.starttime) - Date.parse(a.starttime));
}

/** "Today", "Yesterday", a short date, or a date range for sleep across midnight. */
export function sleepDayLabel(startMs: number, endMs: number | null, now: number, lang: Language): string {
  const end = endMs ?? now;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const short = new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" });
  if (sameDay(startMs, end)) {
    if (sameDay(startMs, now)) return translate(lang, "common.today");
    if (sameDay(startMs, yesterday.getTime())) return translate(lang, "common.yesterday");
    return short.format(startMs);
  }
  return short.formatRange(startMs, end);
}
