// Device-local presentation preference. Deliberately independent of accounts,
// household data, sleep tracking and microphone ownership.
const key = "sleepy.liveActivities.enabled.v1";
const listeners = new Set<() => void>();
function read(): boolean {
  try { return localStorage.getItem(key) !== "false"; } catch { return true; }
}
let enabled = read();
export const liveActivityEnabled = () => enabled;
export const subscribeLiveActivityPreference = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function saveLiveActivityEnabled(value: boolean): void {
  // Fail visibly rather than claiming a preference was saved when storage fails.
  localStorage.setItem(key, String(value));
  enabled = value;
  listeners.forEach(listener => listener());
}
