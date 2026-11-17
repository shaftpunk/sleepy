import { useMemo } from "react";
import { calculateDailySleepForecast, calculateUpcomingDayForecast } from "../analytics/dailySleepForecast";
import { ageInDays } from "../analytics/localDate";
import { calculateNextSleep } from "../analytics/nextSleep";
import type { ActiveSleep, SleepSession } from "../analytics/types";

/* The single source of the sleep forecasts shown in the app. Home (Sleep Wave)
   and History (daily planner) both call this with the same analytics data, so
   they cannot disagree. It only wires the existing calculations together; it
   adds no forecasting rules of its own and persists nothing. */
export function useSleepForecasts({ sessions, active, waveActive = active, now, birthDate }: {
  sessions: SleepSession[];
  /** Active sleep as known to the analytics data. */
  active: ActiveSleep | null;
  /** Active sleep as shown on screen (may be fresher than `active`); used by the remaining-day forecast. */
  waveActive?: ActiveSleep | null;
  now: number;
  birthDate: string | null | undefined;
}) {
  // Recalculate once per minute, on the minute boundary.
  const predictionMinute = Math.ceil(now / 60000) * 60000;
  const ageDays = ageInDays(birthDate, predictionMinute);
  const nextSleep = useMemo(() => calculateNextSleep({ sessions, active, now: predictionMinute, ageDays }),
    [sessions, active, predictionMinute, ageDays]);
  // Remaining-day forecast: same inputs and minute tick as Next Sleep, so it
  // recalculates on every sleep start/stop, edit, delete, realtime update,
  // resume, baby switch and date change those inputs already reflect.
  const dailyForecast = useMemo(() => calculateDailySleepForecast({ sessions, active: waveActive, now: predictionMinute, nextSleep, ageDays }),
    [sessions, waveActive, predictionMinute, nextSleep, ageDays]);
  // At night: a preliminary forecast for the coming day. It replaces (never
  // adds to) the remaining-day forecast, so the two cannot contradict; after
  // the morning wake-up it reports not_applicable and the daytime one returns.
  const upcomingForecast = useMemo(() => calculateUpcomingDayForecast({ sessions, active, now: predictionMinute, ageDays }),
    [sessions, active, predictionMinute, ageDays]);
  const nightForecast = upcomingForecast.status !== "not_applicable";
  return { nextSleep, dayForecast: nightForecast ? null : dailyForecast, upcomingForecast, nightForecast };
}
