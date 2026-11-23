import { useMemo } from "react";
import { ageInDays } from "../analytics/localDate";
import { calculateNextSleep } from "../analytics/nextSleep";
import type { ActiveSleep, SleepSession } from "../analytics/types";

export function useNextSleepPrediction(sessions: SleepSession[], active: ActiveSleep | null, now: number, birthDate?: string | null) {
  const predictionMinute = Math.ceil(now / 60000) * 60000;
  const ageDays = ageInDays(birthDate, predictionMinute);
  return useMemo(() => calculateNextSleep({ sessions, active, now: predictionMinute, ageDays }),
    [sessions, active, predictionMinute, ageDays]);
}
