import { getSleepsOverlappingPeriod, type SleepRecord } from "./sleepService";
import { normalizeSleepRows } from "../analytics/normalize";
import { estimateActiveSleepWakeTime } from "../analytics/activeSleepEstimate";
import { PERSONAL_SLEEP_LOOKBACK_DAYS } from "../analytics/personalSleepProfile";
import { resolveSleepType } from "../analytics/sleepType";

export async function getActiveSleepEstimate(sleep: SleepRecord): Promise<string | null> {
  const startMs = Date.parse(sleep.starttime);
  const active = { id: sleep.id, startMs, sleepTypeRaw: sleep.sleep_type };
  if (!Number.isFinite(startMs) || resolveSleepType(active) !== "nap") return null;
  const rows = await getSleepsOverlappingPeriod(sleep.baby_id,
    new Date(startMs - PERSONAL_SLEEP_LOOKBACK_DAYS * 86400000).toISOString(), sleep.starttime);
  const { sessions } = normalizeSleepRows(rows);
  const wake = estimateActiveSleepWakeTime(sessions, active);
  return wake == null ? null : new Date(wake).toISOString();
}
