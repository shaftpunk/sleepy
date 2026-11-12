import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppStore } from "../stores/appStore";
import { configureSleepLiveActivities, refreshSleepLiveActivities, clearSleepLiveActivities, liveActivitiesSupported, liveActivityBridge, applySleepPresentationChange } from "../services/liveActivityService";
import { SLEEP_PRESENTATION_CHANGED, type SleepPresentationChange } from "../services/sleepPresentationEvents";
import { subscribeToSleepChanges } from "../services/sleepRealtime";

export default function SleepLiveActivityLifecycle() {
  const { user, loading } = useAuth();
  const babies = useAppStore(state => state.babies);
  const babyId = useAppStore(state => state.currentBabyId);
  useEffect(() => {
    if (!loading) void configureSleepLiveActivities(user?.id ?? null, babies.filter(baby => baby.id === babyId));
  }, [loading, user?.id, babies, babyId]);
  useEffect(() => {
    if (!liveActivitiesSupported()) return;
    const refresh = () => { void refreshSleepLiveActivities(); };
    const visible = () => { if (!document.hidden) refresh(); };
    const changed = (event: Event) => { void applySleepPresentationChange((event as Event & { sleepChange?: SleepPresentationChange }).sleepChange ?? {}); };
    // Capacitor's document resume fires on willEnterForeground, which can still
    // be hidden/inactive. The native didBecomeActive event runs afterward.
    const foreground = liveActivityBridge.addListener("foreground", refresh).catch(() => null);
    window.addEventListener(SLEEP_PRESENTATION_CHANGED, changed);
    window.addEventListener("focus", visible);
    document.addEventListener("resume", refresh); document.addEventListener("visibilitychange", visible);
    const off = babyId ? [subscribeToSleepChanges(babyId, refresh)] : [];
    return () => {
      off.forEach(unsubscribe => unsubscribe());
      void foreground.then(handle => handle?.remove());
      window.removeEventListener(SLEEP_PRESENTATION_CHANGED, changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("resume", refresh); document.removeEventListener("visibilitychange", visible);
    };
  }, [babyId]);
  useEffect(() => () => { void clearSleepLiveActivities(); }, []);
  return null;
}
