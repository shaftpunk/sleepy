import type { SleepRecord } from "./sleepService";
import { normalizeSleepRows } from "../analytics/normalize";
import { estimateActiveSleep } from "../analytics/activeSleepEstimate";
import { PERSONAL_SLEEP_LOOKBACK_DAYS } from "../analytics/personalSleepProfile";
import type { ActiveSleepClassification } from "../analytics/personalSleepClassification";
import { sessionGeneration } from "../auth/sessionLifecycle";

export type SleepEstimatePresentation = { classification: ActiveSleepClassification; estimatedWakeTime: string | null };
type HistorySnapshot = { generation: number; from: number; to: number; rows: SleepRecord[]; signature: string };
const history = new Map<string, HistorySnapshot>();
const listeners = new Set<() => void>();
let revision = 0;
export const sleepEstimateHistoryRevision = () => revision;
export function subscribeSleepEstimateHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Reuse the history reads already made by useAnalyticsData. Unavailable or
// incomplete snapshots abstain; classification has no network access.
export function publishSleepEstimateHistory(babyId: string, rows: SleepRecord[], from: number, to: number, generation: number): void {
  if (generation !== sessionGeneration() || rows.some(row => row.baby_id !== babyId)) return;
  for (const [key, value] of history) if (value.generation !== generation) history.delete(key);
  const signature = JSON.stringify(rows.map(row => [row.id, row.starttime, row.endtime, row.durationminutes, row.sleep_type, row.deleted_at]));
  const previous = history.get(babyId);
  if (previous?.generation === generation && previous.to > to) return;
  history.set(babyId, { generation, from, to, rows: rows.map(row => ({ ...row })), signature });
  if (previous?.signature === signature && previous.generation === generation && previous.from <= from && previous.to >= to) return;
  revision++;
  listeners.forEach(listener => listener());
}

export async function getActiveSleepEstimate(sleep: SleepRecord): Promise<SleepEstimatePresentation> {
  const startMs = Date.parse(sleep.starttime);
  const snapshot = history.get(sleep.baby_id);
  const cutoff = startMs - PERSONAL_SLEEP_LOOKBACK_DAYS * 86400000;
  if (!snapshot || snapshot.generation !== sessionGeneration() || !Number.isFinite(startMs) ||
      snapshot.from > cutoff || snapshot.to < startMs) return { classification: "UNCERTAIN", estimatedWakeTime: null };
  const rows = snapshot.rows.filter(row => !row.deleted_at);
  const { sessions } = normalizeSleepRows(rows);
  const result = estimateActiveSleep(sessions, { id: sleep.id, startMs, sleepTypeRaw: sleep.sleep_type });
  return { classification: result.classification,
    estimatedWakeTime: result.estimatedWakeTime === null ? null : new Date(result.estimatedWakeTime).toISOString() };
}
