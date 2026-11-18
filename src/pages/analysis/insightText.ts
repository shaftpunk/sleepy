import { minutesToClockLabel } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { type Language, type TranslationKey } from "../../i18n";
import type { Insight } from "../../analytics/types";

export function insightText(
  insight: Insight,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  lang: Language
): string {
  const p = insight.payload;

  const duration = (minutes: number) => formatDuration(minutes, lang);
  switch (insight.id) {
    case "typical-rhythm":
      return t("analysis.insights.typicalRhythm", {
        bedtime: minutesToClockLabel(Number(p.bedtimeMin)),
        wake: minutesToClockLabel(Number(p.wakeMin)),
      });
    case "median-wake-window":
      return t("analysis.insights.medianWakeWindow", { duration: duration(Number(p.medianMinutes)) });
    case "typical-naps":
      return t(Number(p.count) === 1 ? "analysis.insights.typicalOneNap" : "analysis.insights.typicalNaps",
        { count: Number(p.count), duration: duration(Number(p.minutes)) });
    case "night-share": {
      const night = Math.round(Number(p.atNightPct));
      return t("analysis.insights.nightBalance", { night, day: 100 - night });
    }
    case "typical-longest-stretch":
      return t("analysis.insights.typicalLongestStretch", { duration: duration(Number(p.minutes)) });
    case "weekly-sleep-change": {
      const minutes = Number(p.minutes);
      return t(minutes > 0 ? "analysis.insights.weeklyMore" : "analysis.insights.weeklyLess",
        { duration: duration(Math.abs(minutes)) });
    }
  }
}
