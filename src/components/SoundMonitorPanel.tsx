import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppStore } from "../stores/appStore";
import { useSoundStore } from "../stores/soundStore";
import { useTranslation } from "../i18n";
import { SoundMonitor, type MonitorState } from "../services/soundMonitorService";
import { enqueueSoundEvent, retrySoundEvents, useSoundQueue } from "../services/soundEventQueue";
import type { SleepRecord } from "../services/sleepService";
import "./SoundMonitoring.css";

// Home owns the active sleep and receives existing realtime updates. Unmount
// deliberately releases the microphone; navigation never stops sleep tracking.
export default function SoundMonitorPanel({ sleep }: { sleep: SleepRecord | null }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const babyId = useAppStore((state) => state.currentBabyId);
  const { enabled, sensitivity } = useSoundStore();
  const failed = useSoundQueue((state) => state.failed);
  const pending = useSoundQueue((state) => state.pending);
  const [state, setState] = useState<MonitorState>({ status: "off", level: 0 });
  const startRef = useRef<(() => void) | null>(null);
  const sleepId = sleep?.baby_id === babyId && !sleep?.endtime && !sleep?.deleted_at ? sleep?.id : null;
  const userId = user?.id;
  const eligible = Boolean(enabled && sleepId && babyId && userId && !failed);

  useEffect(() => {
    if (!eligible || !sleepId || !babyId || !userId) return;
    let disposed = false;
    let monitor: SoundMonitor | null = null;
    const start = () => {
      monitor?.stop();
      monitor = new SoundMonitor(sensitivity, (event) => {
        enqueueSoundEvent({ ...event, id: crypto.randomUUID(), sleep_id: sleepId,
          baby_id: babyId, created_by_user_id: userId, event_type: "sound" });
      }, (next) => { if (!disposed) setState(next); });
      void monitor.start(); // start catches permission/hardware failures internally.
    };
    startRef.current = start;
    start();
    return () => { disposed = true; startRef.current = null; monitor?.stop(); };
  }, [eligible, sleepId, babyId, userId, sensitivity]);

  if (!enabled && !failed && pending === 0) return null;
  const status = eligible ? state.status : "off";
  return <aside className="sound-panel" aria-label={t("sound.title")}>
    <div className="sound-line"><strong>{t("sound.title")}</strong>
      <span role="status">{t(`sound.${status}`)}</span>
    </div>
    {eligible && (status === "listening" || status === "detected") &&
      <meter min={0} max={1} value={state.level} aria-label={t("sound.level")} />}
    {eligible && ["paused", "blocked", "error", "off"].includes(status) &&
      <button type="button" className="secondary-button" onClick={() => startRef.current?.()}>{t("sound.restart")}</button>}
    {failed && <div role="status"><p>{t("sound.saveError")}</p>
      <button type="button" className="secondary-button" onClick={() => void retrySoundEvents()}>{t("sound.retrySave")}</button>
    </div>}
    {pending > 0 && !failed && <small>{t("sound.saving")}</small>}
    <small>{t("sound.privacy")}</small>
  </aside>;
}
