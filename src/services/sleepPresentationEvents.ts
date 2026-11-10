export const SLEEP_PRESENTATION_CHANGED = "sleepy:sleep-presentation-changed";

// Optional companion UI, invoked only after successful sleep writes. Never let
// a listener/bridge failure alter the result of a database operation.
export function notifySleepPresentationChanged(): void {
  try { window.dispatchEvent(new Event(SLEEP_PRESENTATION_CHANGED)); }
  catch { /* Presentation is optional, including outside a browser. */ }
}
