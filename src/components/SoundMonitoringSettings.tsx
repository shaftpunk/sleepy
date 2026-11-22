import { useEffect, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { getActiveSleep, type SleepRecord } from "../services/sleepService";
import { subscribeToSleepChanges } from "../services/sleepRealtime";
import SoundMonitorPanel from "./SoundMonitorPanel";
import { useSoundStore } from "../stores/soundStore";
import { useTranslation } from "../i18n";
import { retrySoundEvents, useSoundQueue } from "../services/soundEventQueue";
import "./SoundMonitoring.css";
import { nativeSoundSupported } from "../services/nativeSoundMonitoring";

export default function SoundMonitoringSettings() {
  const { t } = useTranslation();
  const babyId = useAppStore(state => state.currentBabyId);
  const [activeSleep, setActiveSleep] = useState<SleepRecord | null>(null);

  useEffect(() => {
    if (!babyId) return;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const sleep = await getActiveSleep(babyId);
        if (current === request) setActiveSleep(sleep);
      } catch (error) {
        console.error("Failed loading sleep for sound monitoring:", error);
      }
    };
    void refresh();
    const unsubscribe = subscribeToSleepChanges(babyId, refresh);
    const refreshIfVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      request++;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [babyId]);
  const { enabled, sensitivity, setEnabled, setSensitivity } = useSoundStore();
  const failed = useSoundQueue((state) => state.failed);
  return <section className="settings-card sound-settings">
    <label className="sound-toggle">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      <span className="setting-title">{t("sound.title")}</span>
    </label>
    <p className="muted">{t("sound.privacy")}</p>
    <label className="sound-toggle">
      {t("sound.sensitivity")}
      <select className="settings-select" value={sensitivity} onChange={(event) => {
        const value = event.target.value;
        if (value === "low" || value === "medium" || value === "high") setSensitivity(value);
      }}>
        <option value="low">{t("sound.low")}</option>
        <option value="medium">{t("sound.medium")}</option>
        <option value="high">{t("sound.high")}</option>
      </select>
    </label>
    <p className="muted">{t(nativeSoundSupported() ? "sound.nativeLimitation" : "sound.limitation")}</p>
    <p className="muted">{t("sound.notAlarm")}</p>
    <SoundMonitorPanel sleep={activeSleep?.baby_id === babyId ? activeSleep : null} />
    {failed && <div role="status"><p>{t("sound.saveError")}</p>
      <button type="button" className="secondary-button" onClick={() => void retrySoundEvents()}>{t("sound.retrySave")}</button>
    </div>}
  </section>;
}
