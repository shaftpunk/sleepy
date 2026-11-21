import { Capacitor, registerPlugin } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const native = registerPlugin<{
  schedule(options: { at: number; title: string; body: string }): Promise<void>;
  cancel(): Promise<void>;
}>("SleepyPredictionReminder");
export const reminderAvailable = () => Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("SleepyPredictionReminder");
export const reminderKey = (user: string, baby: string) => "sleepy.onset.enabled." + user + "." + baby;
export const preferenceChanged = "sleepy:onset-preference";
export async function requestReminderPermission() {
  const status = await PushNotifications.checkPermissions();
  return status.receive === "granted" || (status.receive !== "denied" &&
    (await PushNotifications.requestPermissions()).receive === "granted");
}

type Candidate = { event: string; peak: number; title: string; body: string };
type Pending = { event: string; at: number; title: string };
const pendingKey = "sleepy.onset.pending";
let queue = Promise.resolve();
let revision = 0;

export function reconcileReminder(candidate: Candidate | null) {
  const version = ++revision;
  queue = queue.catch(() => {}).then(async () => {
    if (version !== revision || !reminderAvailable()) return;
    const permitted = candidate && (await PushNotifications.checkPermissions()).receive === "granted";
    if (version !== revision) return;
    const now = Date.now();
    const previous: Pending | null = JSON.parse(localStorage.getItem(pendingKey) ?? "null");
    // A past trigger may already have fired even if the OS notification was dismissed.
    if (previous && previous.at <= now) localStorage.setItem("sleepy.onset.sent." + previous.event, "1");
    const at = candidate ? candidate.peak - 10 * 60000 : 0;
    if (!candidate || !permitted || at <= now || localStorage.getItem("sleepy.onset.sent." + candidate.event)) {
      await native.cancel();
      localStorage.removeItem(pendingKey);
      return;
    }
    if (previous?.event === candidate.event && previous.title === candidate.title && Math.abs(previous.at - at) < 10 * 60000) return;
    await native.schedule({ at, title: candidate.title, body: candidate.body });
    localStorage.setItem(pendingKey, JSON.stringify({ event: candidate.event, at, title: candidate.title }));
  }).catch(error => console.warn("Sleep reminder reconciliation failed", error));
  return queue;
}
