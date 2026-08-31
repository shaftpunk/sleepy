import { dayKeyOf, lastNLocalDayKeys } from "./time";
import type { SleepSession } from "./types";

export type MonthBarTier = "high" | "low" | "empty";

export type MonthBar = {
  dayKey: string;
  totalMinutes: number;
  pctOfMax: number;
  tier: MonthBarTier;
};

export function computeMonthlyBars(
  sessions: SleepSession[],
  now: number
): MonthBar[] {
  const keys = lastNLocalDayKeys(now, 30);

  const totals = new Map<string, number>();
  for (const key of keys) totals.set(key, 0);

  for (const s of sessions) {
    const key = dayKeyOf(s.startMs);
    if (!totals.has(key)) continue;
    totals.set(key, (totals.get(key) ?? 0) + s.durationMin);
  }

  const maxMinutes = Math.max(1, ...totals.values());

  return keys.map((key) => {
    const totalMinutes = totals.get(key) ?? 0;
    const pctOfMax = (totalMinutes / maxMinutes) * 100;

    const tier: MonthBarTier =
      totalMinutes === 0 ? "empty" : pctOfMax >= 75 ? "high" : "low";

    return { dayKey: key, totalMinutes, pctOfMax, tier };
  });
}

export type MonthSummary = {
  totalMinutes: number;
  avgPerDayWithData: number | null;
  bestDay: { dayKey: string; totalMinutes: number } | null;
};

export function computeMonthSummary(bars: MonthBar[]): MonthSummary {
  const totalMinutes = bars.reduce((sum, b) => sum + b.totalMinutes, 0);
  const withData = bars.filter((b) => b.totalMinutes > 0);

  const avgPerDayWithData = withData.length
    ? withData.reduce((sum, b) => sum + b.totalMinutes, 0) / withData.length
    : null;

  const bestDay = withData.length
    ? withData.reduce((best, b) => (b.totalMinutes > best.totalMinutes ? b : best))
    : null;

  return {
    totalMinutes,
    avgPerDayWithData,
    bestDay: bestDay ? { dayKey: bestDay.dayKey, totalMinutes: bestDay.totalMinutes } : null,
  };
}
