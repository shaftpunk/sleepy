import type { ActiveSleep, SleepSession } from "../../analytics/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Presentation only: retain real record times for details, and clip only the
// interaction geometry to the same rolling window as computeSleepClock.
export function sleepClockDetails(sessions: SleepSession[], active: ActiveSleep | null, now: number) {
  const windowStart = now - DAY_MS;
  const records = sessions.map(session => ({
    id: session.id, startMs: session.startMs, endMs: session.endMs, isActive: false,
  }));
  if (active) records.push({ id: active.id, startMs: active.startMs, endMs: now, isActive: true });
  return records.filter(record => record.endMs > windowStart && record.startMs < now && record.endMs > record.startMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map(record => ({
      ...record,
      key: `${record.isActive ? "active" : "completed"}:${record.id}`,
      visibleStartMs: Math.max(record.startMs, windowStart),
      visibleEndMs: Math.min(record.endMs, now),
      durationMinutes: (Math.min(record.endMs, now) - record.startMs) / 60000,
    }));
}
