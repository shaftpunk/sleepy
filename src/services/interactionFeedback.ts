import { Capacitor, registerPlugin } from "@capacitor/core";
const feedback = registerPlugin<{ selection(): Promise<void> }>("SleepyFeedback");
export function selectionFeedback(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios" || !Capacitor.isPluginAvailable("SleepyFeedback")) return;
  try { void feedback.selection().catch(() => { /* Haptics never gate a sleep action. */ }); }
  catch { /* A missing bridge must not interrupt a hold either. */ }
}
