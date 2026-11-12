// UI bounds only. The existing startSleep/stopSleep services remain authoritative.
export const HOLD_DELAY_MS = 450;
export const HOLD_STEP_MS = 600;
export const HOLD_MOVE_TOLERANCE_PX = 20;
export const HOLD_MAX_MINUTES = 60;
export function maximumBackdate(now: number, after: number | null, ending: boolean): number {
  if (after === null) return HOLD_MAX_MINUTES;
  const minutes = (now - after) / 60000;
  return Math.max(0, Math.min(HOLD_MAX_MINUTES, ending ? Math.ceil(minutes) - 1 : Math.floor(minutes)));
}
export function localDateTimeInput(now: number): string {
  const date = new Date(now);
  return new Date(now - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function minutesBeforeNow(value: string, now: number, after: number | null, ending: boolean): number | null {
  const selected = new Date(value).getTime();
  if (!value || !Number.isFinite(selected) || selected > now ||
      (after !== null && (ending ? selected <= after : selected < after))) return null;
  // Existing start/stop commands accept whole minutes. Preserve the selected
  // local clock minute, including the same seconds as a normal minutes-ago entry.
  const minutes = Math.floor((now - selected) / 60000);
  const actual = now - minutes * 60000;
  if (after !== null && (ending ? actual <= after : actual < after)) return null;
  return minutes;
}
