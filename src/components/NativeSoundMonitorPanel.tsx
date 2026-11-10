import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppStore } from "../stores/appStore";
import { useSoundStore } from "../stores/soundStore";
import { useTranslation } from "../i18n";
import { nativeSoundSnapshot, subscribeNativeSound, startNativeSound, stopNativeSound, synchronizeNativeSoundEvents, validateNativeSoundSleep } from "../services/nativeSoundMonitoring";
import type { SleepRecord } from "../services/sleepService";
import "./SoundMonitoring.css";
import NativeSoundLevelMeter from "./NativeSoundLevelMeter";

export default function NativeSoundMonitorPanel({ sleep }: { sleep: SleepRecord | null }) {
  const { t } = useTranslation(); const { user } = useAuth();
  const babyId = useAppStore(s => s.currentBabyId);
  const { enabled, sensitivity } = useSoundStore();
  const state = useSyncExternalStore(subscribeNativeSound, nativeSoundSnapshot);
  const eligible = Boolean(enabled && user && babyId && sleep?.baby_id === babyId && !sleep.endtime && !sleep.deleted_at);
  useEffect(() => { if (state.active && sleep?.endtime) void validateNativeSoundSleep().catch(() => {}); }, [state.active, sleep?.endtime]);
  if (!enabled && !state.active && !state.queueCount) return null;
  const keys = { off: "sound.native_off", starting: "sound.native_starting", listening: "sound.native_listening",
    detected: "sound.native_detected", paused: "sound.native_paused", blocked: "sound.native_blocked",
    unavailable: "sound.native_unavailable", error: "sound.native_error", validating: "sound.native_validating",
    "validation-error": "sound.native_validation_error" } as const;
  const status = Object.hasOwn(keys, state.status) ? state.status as keyof typeof keys : "error";
  return <aside className="sound-panel" aria-label={t("sound.title")}>
    <div className="sound-line"><strong>{t("sound.title")}</strong><span role="status">{t(keys[status])}</span></div>
    {state.running && <NativeSoundLevelMeter level={state.level} label={t("sound.level")} />}
    {state.active ? <button className="secondary-button" onClick={() => void stopNativeSound("manual-stop").then(synchronizeNativeSoundEvents).catch(() => {})}>{t("sound.stop")}</button>
      : eligible && user && babyId && sleep && <button className="secondary-button" onClick={() => void startNativeSound({ userId: user.id, babyId, sleepId: sleep.id, sensitivity }).catch(() => {})}>{t("sound.restart")}</button>}
    {state.active && <small>{t("sound.backgroundActive")}</small>}
    {!state.active && state.stopReason?.startsWith("remote-") && <small role="status">{t("sound.remoteStopped")}</small>}
    {state.syncFailed && <div role="status"><p>{t("sound.nativeSaveError")}</p><button className="secondary-button" onClick={() => void synchronizeNativeSoundEvents().catch(() => {})}>{t("sound.retrySave")}</button></div>}
    <small>{t("sound.privacy")}</small>
  </aside>;
}
