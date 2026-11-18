export { median, sameDay, startOfLocalDay as startOfDay, two } from "../analytics/time";

import { sameDay } from "../analytics/time";
import { LOCALES, translate, type Language } from "../i18n";
import type { FeedSide, FeedType } from "../services/feedService";

export function formatDuration(minutes: number, lang: Language): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;

  if (!hours) return translate(lang, "common.durationMinutes", { minutes: rest });
  if (!rest) return translate(lang, "common.durationHours", { hours });

  return translate(lang, "common.durationHoursMinutes", { hours, minutes: rest });
}

export function formatClock(ms: number, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALES[lang], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** A sleep time range for display, in local time.
    Same day as now: "18:59–19:23". Same earlier/later day: the date once,
    "17. nov. 18:59–19:23". Across midnight: both dates, "17. nov. 23:30 – 18. nov. 00:15".
    A DST offset change inside the range adds the offset to both clocks. */
export function formatSleepRange(startMs: number, endMs: number, nowMs: number, lang: Language): string {
  const offsetChanges = new Date(startMs).getTimezoneOffset() !== new Date(endMs).getTimezoneOffset();
  const clock = (ms: number) => offsetChanges
    ? new Intl.DateTimeFormat(LOCALES[lang], { hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(ms)
    : formatClock(ms, lang);
  const date = (ms: number) => new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" }).format(ms);
  if (sameDay(startMs, endMs)) return `${sameDay(startMs, nowMs) ? "" : `${date(startMs)} `}${clock(startMs)}–${clock(endMs)}`;
  return `${date(startMs)} ${clock(startMs)} – ${date(endMs)} ${clock(endMs)}`;
}

export function relativeDayLabel(ms: number, lang: Language): string {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(
    (new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / dayMs
  );

  if (diffDays === 0) return translate(lang, "common.today");
  if (diffDays === -1) return translate(lang, "common.yesterday");

  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(ms));
}

export function stars(rate: number | null): string {
  if (rate == null || rate <= 0) return "-";
  return "★".repeat(Math.round(rate));
}

export function feedTypeLabel(type: FeedType, lang: Language): string {
  if (type === "bottle") return translate(lang, "common.feedTypeBottle");
  if (type === "breast") return translate(lang, "common.feedTypeBreast");
  return translate(lang, "common.feedTypeFood");
}

export function sideLabel(side: FeedSide, lang: Language): string | null {
  if (side === "left") return translate(lang, "common.sideLeft");
  if (side === "right") return translate(lang, "common.sideRight");
  if (side === "both") return translate(lang, "common.sideBoth");
  return null;
}
