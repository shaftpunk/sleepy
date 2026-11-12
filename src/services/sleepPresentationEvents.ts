export const SLEEP_PRESENTATION_CHANGED = "sleepy:sleep-presentation-changed";
export type SleepPresentationChange = { endedSleepId?: string;
  snapshot?: { babyId: string; activeSleepId: string | null; generation: number } };
let revision = 0;
export const sleepPresentationRevision = () => revision;

// Optional companion UI, invoked only after successful sleep writes. Never let
// a listener/bridge failure alter the result of a database operation.
export function notifySleepPresentationChanged(change: SleepPresentationChange = {}): void {
  if (!change.snapshot) revision++;
  try { window.dispatchEvent(Object.assign(new Event(SLEEP_PRESENTATION_CHANGED), { sleepChange: change })); }
  catch { /* Presentation is optional, including outside a browser. */ }
}
