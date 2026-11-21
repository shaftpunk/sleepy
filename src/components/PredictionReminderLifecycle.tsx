import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useAppStore } from "../stores/appStore";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { calculateNextSleep } from "../analytics/nextSleep";
import { ageInDays } from "../analytics/localDate";
import { useTranslation } from "../i18n";
import { formatClock } from "../lib/format";
import { preferenceChanged, reconcileReminder, reminderAvailable, reminderKey, requestReminderPermission } from "../services/predictionReminder";
import { SLEEP_PRESENTATION_CHANGED, type SleepPresentationChange } from "../services/sleepPresentationEvents";

function subscribe(listener: () => void) {
  window.addEventListener(preferenceChanged, listener);
  return () => window.removeEventListener(preferenceChanged, listener);
}
function usePreference(key: string) {
  return useSyncExternalStore(subscribe, () => localStorage.getItem(key) === "1");
}

export function ReminderSetting({ user, baby }: { user: string; baby: string }) {
  const { t } = useTranslation();
  const key = reminderKey(user, baby);
  const enabled = usePreference(key);
  const [denied, setDenied] = useState(false);
  if (!reminderAvailable()) return null;
  return <div><label><input type="checkbox" checked={enabled} onChange={async event => {
    const checked = event.target.checked;
    if (checked && !await requestReminderPermission().catch(() => false)) { setDenied(true); return; }
    setDenied(false);
    localStorage.setItem(key, checked ? "1" : "0");
    window.dispatchEvent(new Event(preferenceChanged));
  }} /> {t("onsetReminder.setting")}</label>
    <p className="muted">{t(denied ? "onsetReminder.permission" : "onsetReminder.timing")}</p>
  </div>;
}

function EnabledReminder({ user, baby }: { user: string; baby: { id: string; name: string; birth_date?: string | null } }) {
  const { sessions, active, loading } = useAnalyticsData(baby.id);
  const { t, lang } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60000);
    document.addEventListener("resume", update);
    const invalidate = (event: Event) => {
      const change = (event as Event & { sleepChange?: SleepPresentationChange }).sleepChange;
      if (!change?.snapshot || (change.snapshot.babyId === baby.id && change.snapshot.activeSleepId)) void reconcileReminder(null);
    };
    window.addEventListener(SLEEP_PRESENTATION_CHANGED, invalidate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("resume", update);
      window.removeEventListener(SLEEP_PRESENTATION_CHANGED, invalidate);
      void reconcileReminder(null);
    };
  }, [baby.id]);
  useEffect(() => {
    if (loading) return;
    const minute = Math.ceil(Math.max(now, Date.now()) / 60000) * 60000;
    const { peak } = calculateNextSleep({ sessions, active, now: minute, ageDays: ageInDays(baby.birth_date, minute) });
    const anchor = peak && sessions.find(s => s.endMs === peak.anchorEnd);
    void reconcileReminder(peak && anchor ? {
      event: [user,baby.id,anchor.id].join("."), peak: peak.peakTime,
      title: t("onsetReminder.title", { name: baby.name }),
      body: t("onsetReminder.body", { time: formatClock(peak.peakTime, lang) }),
    } : null);
  }, [sessions, active, loading, user, baby, now, t, lang]);
  return null;
}

export default function PredictionReminderLifecycle() {
  const { user } = useAuth();
  const baby = useAppStore(s => s.babies.find(b => b.id === s.currentBabyId));
  const enabled = usePreference(user && baby ? reminderKey(user.id,baby.id) : "");
  useEffect(() => {
    if (reminderAvailable() && (!enabled || !user || !baby)) void reconcileReminder(null);
  }, [enabled,user,baby]);
  return reminderAvailable() && enabled && user && baby ? <EnabledReminder key={user.id+baby.id} user={user.id} baby={baby} /> : null;
}
