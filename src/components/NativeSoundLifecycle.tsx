import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppStore } from "../stores/appStore";
import { useSoundStore } from "../stores/soundStore";
import { supabase } from "../lib/supabase";
import { nativeSoundSupported, nativeSoundSnapshot, subscribeNativeSound, reconcileNativeSound, stopNativeSound, validateNativeSoundSleep } from "../services/nativeSoundMonitoring";

// App lifetime, not Home route lifetime. Never starts microphone capture.
export default function NativeSoundLifecycle() {
  const { user, loading } = useAuth();
  const babyId = useAppStore(s => s.currentBabyId);
  const enabled = useSoundStore(s => s.enabled);
  const sensitivity = useSoundStore(s => s.sensitivity);
  const state = useSyncExternalStore(subscribeNativeSound, nativeSoundSnapshot);
  useEffect(() => {
    if (!nativeSoundSupported() || loading) return;
    void reconcileNativeSound(user?.id ?? null, babyId, enabled, sensitivity).then(validateNativeSoundSleep).catch(() => {});
  }, [loading, user?.id, babyId, enabled, sensitivity]);
  useEffect(() => {
    if (!nativeSoundSupported()) return;
    const resume = () => { void validateNativeSoundSleep().catch(() => {}); };
    const visible = () => { if (!document.hidden) resume(); };
    document.addEventListener("resume", resume); document.addEventListener("visibilitychange", visible);
    return () => { document.removeEventListener("resume", resume); document.removeEventListener("visibilitychange", visible); void stopNativeSound("app-account-unmounted").catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!nativeSoundSupported() || !state.active || !state.sleepId) return;
    const channel = supabase.channel(`native-sound-validity-${state.sleepId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "sleep", filter: `id=eq.${state.sleepId}`,
    }, () => { void validateNativeSoundSleep().catch(() => {}); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [state.active, state.sleepId]);
  return null;
}
