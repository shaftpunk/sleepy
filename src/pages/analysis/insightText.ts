import { minutesToClockLabel, two } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { LOCALES, type Language, type TranslationKey } from "../../i18n";
import type { Insight } from "../../analytics/types";

function weekdayName(dayKey: string, lang: Language): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const name = new Intl.DateTimeFormat(LOCALES[lang], { weekday: "long" }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function insightText(
  insight: Insight,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  lang: Language
): string {
  const p = insight.payload;

  switch (insight.id) {
    case "busiest-window": {
      const start = Number(p.bucketIndex) * 3;
      const end = start + 3;
      return t("analysis.insights.busiestWindow", { start: two(start), end: two(end) });
    }

    case "typical-rhythm": {
      return t("analysis.insights.typicalRhythm", {
        bedtime: minutesToClockLabel(Number(p.bedtimeMin)),
        wake: minutesToClockLabel(Number(p.wakeMin)),
      });
    }

    case "bedtime-consistency": {
      const stddev = Math.round(Number(p.stddevMinutes));
      const key =
        p.label === "stable"
          ? "analysis.insights.bedtimeStable"
          : p.label === "somewhat-variable"
            ? "analysis.insights.bedtimeSomewhatVariable"
            : "analysis.insights.bedtimeHighlyVariable";
      return t(key, { stddev });
    }

    case "best-day-last-7": {
      return t("analysis.insights.bestDay", {
        weekday: weekdayName(String(p.dayKey), lang),
        duration: formatDuration(Number(p.totalMinutes), lang),
      });
    }

    case "night-share": {
      const pct = Math.round(Number(p.atNightPct));
      if (p.tier === "high") return t("analysis.insights.nightShareHigh", { pct });
      if (p.tier === "mid") return t("analysis.insights.nightShareMid", { pct });
      return t("analysis.insights.nightShareLow", { pct: 100 - pct });
    }

    case "avg-duration-comparison": {
      return t("analysis.insights.avgDurationComparison", {
        nightAvg: formatDuration(Number(p.nightAvgMin), lang),
        napAvg: formatDuration(Number(p.napAvgMin), lang),
      });
    }

    case "quality-average": {
      const avg = Number(p.avgRating).toFixed(1);
      const key =
        p.tier === "high"
          ? "analysis.insights.qualityAverageHigh"
          : p.tier === "mid"
            ? "analysis.insights.qualityAverageMid"
            : "analysis.insights.qualityAverageLow";
      return t(key, { avg });
    }

    case "quality-trend": {
      return t(
        p.direction === "up"
          ? "analysis.insights.qualityTrendUp"
          : "analysis.insights.qualityTrendDown"
      );
    }

    case "nap-consistency": {
      const min = Number(p.minCount);
      const max = Number(p.maxCount);
      return Number(p.spread) <= 1
        ? t("analysis.insights.napConsistencyEven", { min, max })
        : t("analysis.insights.napConsistencyVaries", { min, max });
    }

    case "median-wake-window": {
      return t("analysis.insights.medianWakeWindow", {
        duration: formatDuration(Number(p.medianMinutes), lang),
      });
    }

    case "wake-window-trend": {
      if (p.direction === "lengthening") {
        return t("analysis.insights.wakeWindowLengthening", {
          early: formatDuration(Number(p.earlyMedian), lang),
          late: formatDuration(Number(p.lateMedian), lang),
        });
      }
      if (p.direction === "shortening") {
        return t("analysis.insights.wakeWindowShortening");
      }
      return t("analysis.insights.wakeWindowSteady");
    }

    case "missing-data": {
      return t("analysis.insights.missingData", { count: Number(p.count) });
    }

    case "long-sleep-milestone": {
      return t("analysis.insights.longSleepMilestone", {
        duration: formatDuration(Number(p.minutes), lang),
      });
    }

    case "daily-share": {
      return t("analysis.insights.dailyShare", { pct: Math.round(Number(p.pct)) });
    }

    case "fallback-no-data":
    default: {
      return t("analysis.insights.fallbackNoData");
    }
  }
}
