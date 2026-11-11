import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "../i18n";
import { liveActivityEnabled, subscribeLiveActivityPreference } from "../services/liveActivityPreference";
import { setSleepLiveActivitiesEnabled } from "../services/liveActivityService";

export default function LiveActivitySettings() {
  const { t } = useTranslation();
  const enabled = useSyncExternalStore(subscribeLiveActivityPreference, liveActivityEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  async function change(value: boolean) {
    setSaving(true); setError(false);
    try { await setSleepLiveActivitiesEnabled(value); }
    catch (error) { console.error("Could not update Live Activity preference", error); setError(true); }
    finally { setSaving(false); }
  }
  return <section className="settings-card settings-card--stack">
    <div className="notification-setting-row">
      <div className="setting-copy">
        <p className="setting-title" id="live-activity-label">{t("settings.liveActivity")}</p>
        <p className="muted" id="live-activity-description">{t("settings.liveActivityDescription")}</p>
      </div>
      <label className="notification-toggle">
        <input type="checkbox" role="switch" aria-labelledby="live-activity-label"
          aria-describedby="live-activity-description" checked={enabled} disabled={saving}
          onChange={event => void change(event.target.checked)} />
        <span className="notification-toggle__slider" />
      </label>
    </div>
    {error && <p className="settings-error" role="alert">{t("settings.liveActivitySaveError")}</p>}
  </section>;
}
