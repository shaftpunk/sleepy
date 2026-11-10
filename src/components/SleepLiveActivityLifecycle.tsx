import { useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppStore } from "../stores/appStore";
import { configureSleepLiveActivities, refreshSleepLiveActivities, clearSleepLiveActivities, liveActivitiesSupported } from "../services/liveActivityService";
import { SLEEP_PRESENTATION_CHANGED } from "../services/sleepPresentationEvents";
import { subscribeToSleepChanges } from "../services/sleepRealtime";

export default function SleepLiveActivityLifecycle() {
  const { user, loading } = useAuth();
  const babies = useAppStore(state => state.babies);
  useEffect(() => {
    if (!loading) void configureSleepLiveActivities(user?.id ?? null, babies);
  }, [loading, user?.id, babies]);
  useEffect(() => {
    if (!liveActivitiesSupported()) return;
    const refresh = () => { void refreshSleepLiveActivities(); };
    const visible = () => { if (!document.hidden) refresh(); };
    window.addEventListener(SLEEP_PRESENTATION_CHANGED, refresh);
    document.addEventListener("resume", refresh); document.addEventListener("visibilitychange", visible);
    const off = babies.map(baby => subscribeToSleepChanges(baby.id, refresh));
    return () => {
      off.forEach(unsubscribe => unsubscribe());
      window.removeEventListener(SLEEP_PRESENTATION_CHANGED, refresh);
      document.removeEventListener("resume", refresh); document.removeEventListener("visibilitychange", visible);
    };
  }, [babies]);
  useEffect(() => () => { void clearSleepLiveActivities(); }, []);
  return null;
}
