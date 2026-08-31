import {
  average,
  circularMeanTimeOfDay,
  dayKeyOf,
  lastNLocalDayKeys,
  median,
  minutesSinceLocalMidnight,
} from "./time";
import { resolveSleepType } from "./sleepType";
import { computeWakeWindows, groupWakeWindows } from "./wakeWindows";
import { computeHourlyDistribution } from "./day";
import { computeWindowAverage } from "./overview";
import type { Insight, SleepSession } from "./types";

export type BedtimeConsistency = {
  stddevMinutes: number;
  label: "svært stabil" | "varierer noe" | "varierer mye";
};

export type QualityDistributionRow = {
  rating: 5 | 4 | 3 | 2 | 1;
  count: number;
  pctOfMax: number;
  sharePct: number;
};

// One row per rating 5->1, bar % relative to the most common rating, detail
// = share of RATED sessions (not all sessions).
export function computeQualityDistribution(sessions: SleepSession[]): QualityDistributionRow[] {
  const rated = sessions.filter((s) => s.rate != null);
  const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

  for (const s of rated) {
    const r = Math.round(s.rate as number);
    if (r >= 1 && r <= 5) counts[r] = (counts[r] ?? 0) + 1;
  }

  const maxCount = Math.max(0, ...Object.values(counts));

  return ([5, 4, 3, 2, 1] as const).map((rating) => ({
    rating,
    count: counts[rating],
    pctOfMax: maxCount ? (counts[rating] / maxCount) * 100 : 0,
    sharePct: rated.length ? (counts[rating] / rated.length) * 100 : 0,
  }));
}

export type NightDaySplitRow = {
  label: "Natt" | "Dagsøvn";
  totalMinutes: number;
  sessionCount: number;
  sharePct: number;
};

// Uses the same populated-or-inferred SLEEP_TYPE resolution as the KPI.
export function computeNightVsDayBreakdown(sessions: SleepSession[]): NightDaySplitRow[] {
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  const night = sessions.filter((s) => resolveSleepType(s) === "night");
  const day = sessions.filter((s) => resolveSleepType(s) === "nap");

  const row = (label: "Natt" | "Dagsøvn", arr: SleepSession[]): NightDaySplitRow => {
    const minutes = arr.reduce((sum, s) => sum + s.durationMin, 0);
    return {
      label,
      totalMinutes: minutes,
      sessionCount: arr.length,
      sharePct: totalMinutes ? (minutes / totalMinutes) * 100 : 0,
    };
  };

  return [row("Natt", night), row("Dagsøvn", day)];
}

// Unwraps each bedtime around the dataset's own circular mean before taking
// a plain (population) standard deviation, so e.g. 23:50 and 00:10 land
// close together instead of ~23h40m apart. Population stddev (÷n, not
// ÷(n-1)) since we're describing this exact set of observed nights, not
// inferring a wider population.
export function computeBedtimeConsistency(
  nightSessions: SleepSession[]
): BedtimeConsistency | null {
  if (nightSessions.length < 3) return null;

  const bedtimes = nightSessions.map((s) => minutesSinceLocalMidnight(s.startMs));
  const pivot = circularMeanTimeOfDay(bedtimes);

  const unwrapped = bedtimes.map((v) => {
    let diff = v - pivot;
    diff = ((diff % 1440) + 1440) % 1440;
    if (diff > 720) diff -= 1440;
    return pivot + diff;
  });

  const mean = average(unwrapped);
  const variance = unwrapped.reduce((sum, v) => sum + (v - mean) ** 2, 0) / unwrapped.length;
  const stddevMinutes = Math.sqrt(variance);

  const label =
    stddevMinutes <= 20 ? "svært stabil" : stddevMinutes <= 45 ? "varierer noe" : "varierer mye";

  return { stddevMinutes, label };
}

function groupSumByLocalDay(sessions: SleepSession[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    const key = dayKeyOf(s.startMs);
    totals.set(key, (totals.get(key) ?? 0) + s.durationMin);
  }
  return totals;
}

// Precomputes every shared stat once, then emits insights in the spec's
// fixed order; each guard is independent, so relative order among qualifying
// insights is preserved without a separate sort step.
export function generateInsights(sessions: SleepSession[], now: number): Insight[] {
  const insights: Insight[] = [];

  const last7Keys = new Set(lastNLocalDayKeys(now, 7));
  const last7Sessions = sessions.filter((s) => last7Keys.has(dayKeyOf(s.startMs)));

  const nightSessions = sessions.filter((s) => resolveSleepType(s) === "night");
  const napSessions = sessions.filter((s) => resolveSleepType(s) === "nap");

  const wakeResult = computeWakeWindows(sessions);
  const wakeGroups = groupWakeWindows(wakeResult.windows);
  const overallMedianWake = wakeResult.windows.length
    ? median(wakeResult.windows.map((w) => w.minutes))
    : null;

  const bucketDist = computeHourlyDistribution(sessions, now);

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  const nightMinutes = nightSessions.reduce((sum, s) => sum + s.durationMin, 0);
  const atNightPct = totalMinutes > 0 ? (nightMinutes / totalMinutes) * 100 : null;

  const longest = sessions.reduce((max, s) => Math.max(max, s.durationMin), 0);

  const ratedSessions = sessions.filter((s) => s.rate != null);

  const bedtimeConsist = computeBedtimeConsistency(nightSessions);

  const rhythm =
    nightSessions.length >= 2
      ? {
          bedtimeMin: circularMeanTimeOfDay(nightSessions.map((s) => minutesSinceLocalMidnight(s.startMs))),
          wakeMin: circularMeanTimeOfDay(nightSessions.map((s) => minutesSinceLocalMidnight(s.endMs))),
        }
      : null;

  const dayTotalsLast7 = groupSumByLocalDay(last7Sessions);
  const bestDayLast7 = dayTotalsLast7.size
    ? [...dayTotalsLast7.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))
    : null;

  const sevenDayAvg = computeWindowAverage(sessions, now, 7);

  // 1. Busiest 3-hour window
  if (bucketDist.totalMinutes > 0) {
    insights.push({
      id: "busiest-window",
      payload: {
        bucketIndex: bucketDist.busiestIndex,
        sharePct: (bucketDist.bucketMinutes[bucketDist.busiestIndex] / bucketDist.totalMinutes) * 100,
      },
    });
  }

  // 2. Typical rhythm
  if (nightSessions.length >= 2 && rhythm) {
    insights.push({
      id: "typical-rhythm",
      payload: { bedtimeMin: rhythm.bedtimeMin, wakeMin: rhythm.wakeMin },
    });
  }

  // 3. Bedtime consistency
  if (nightSessions.length >= 3 && bedtimeConsist) {
    insights.push({
      id: "bedtime-consistency",
      payload: { stddevMinutes: bedtimeConsist.stddevMinutes, label: bedtimeConsist.label },
    });
  }

  // 4. Best day of last 7
  if (bestDayLast7) {
    insights.push({
      id: "best-day-last-7",
      payload: { dayKey: bestDayLast7[0], totalMinutes: bestDayLast7[1] },
    });
  }

  // 5. Night share tiers
  if (atNightPct != null) {
    const tier = atNightPct >= 70 ? "high" : atNightPct >= 45 ? "mid" : "low";
    insights.push({ id: "night-share", payload: { atNightPct, tier } });
  }

  // 6. Avg duration comparison
  if (nightSessions.length > 0 && napSessions.length > 0) {
    insights.push({
      id: "avg-duration-comparison",
      payload: {
        nightAvgMin: average(nightSessions.map((s) => s.durationMin)),
        napAvgMin: average(napSessions.map((s) => s.durationMin)),
      },
    });
  }

  // 7. Quality average
  if (ratedSessions.length > 0) {
    const avgRating = average(ratedSessions.map((s) => s.rate as number));
    const tier = avgRating >= 4 ? "high" : avgRating >= 3 ? "mid" : "low";
    insights.push({ id: "quality-average", payload: { avgRating, tier } });
  }

  // 8. Quality trend
  if (ratedSessions.length >= 6) {
    const sortedByStart = [...ratedSessions].sort((a, b) => a.startMs - b.startMs);
    const mid = Math.floor(sortedByStart.length / 2);
    const firstHalf = sortedByStart.slice(0, mid);
    const secondHalf = sortedByStart.slice(mid);
    const diff =
      average(secondHalf.map((s) => s.rate as number)) - average(firstHalf.map((s) => s.rate as number));

    if (Math.abs(diff) >= 0.5) {
      insights.push({
        id: "quality-trend",
        payload: { diff, direction: diff > 0 ? "up" : "down" },
      });
    }
  }

  // 9. Nap consistency (last 7 days)
  const daysWithDataLast7 = new Set(last7Sessions.map((s) => dayKeyOf(s.startMs)));
  if (daysWithDataLast7.size >= 3) {
    const perDayCounts = new Map<string, number>();
    for (const s of last7Sessions) {
      const key = dayKeyOf(s.startMs);
      perDayCounts.set(key, (perDayCounts.get(key) ?? 0) + 1);
    }
    const counts = [...perDayCounts.values()];
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);

    insights.push({
      id: "nap-consistency",
      payload: { maxCount, minCount, spread: maxCount - minCount },
    });
  }

  // 10. Median wake window
  if (wakeResult.windows.length >= 1 && overallMedianWake != null) {
    insights.push({ id: "median-wake-window", payload: { medianMinutes: overallMedianWake } });
  }

  // 11. Wake windows lengthening/shortening/steady through the day — a
  // three-way branch once the sample guard passes (not only when the diff
  // crosses the +-15min threshold).
  const group0 = wakeGroups[0];
  const group3plus = wakeGroups[3];
  if (
    wakeResult.windows.length >= 3 &&
    group0.count >= 2 &&
    group3plus.count >= 2 &&
    group0.medianMinutes != null &&
    group3plus.medianMinutes != null
  ) {
    const diff = group3plus.medianMinutes - group0.medianMinutes;
    const direction = diff > 15 ? "lengthening" : diff < -15 ? "shortening" : "steady";

    insights.push({
      id: "wake-window-trend",
      payload: {
        diff,
        direction,
        earlyMedian: group0.medianMinutes,
        lateMedian: group3plus.medianMinutes,
      },
    });
  }

  // 12. Missing-data warning
  if (wakeResult.excludedGapCount >= 3) {
    insights.push({ id: "missing-data", payload: { count: wakeResult.excludedGapCount } });
  }

  // 13. Long-sleep milestone
  if (longest >= 240) {
    insights.push({ id: "long-sleep-milestone", payload: { minutes: longest } });
  }

  // 14. Daily share
  if (sevenDayAvg.avgMinutes != null) {
    insights.push({
      id: "daily-share",
      payload: { pct: (sevenDayAvg.avgMinutes / 1440) * 100 },
    });
  }

  if (insights.length === 0) {
    return [{ id: "fallback-no-data", payload: {} }];
  }

  return insights;
}
