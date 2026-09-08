import { useSoundStore } from "../stores/soundStore";
import { useTranslation } from "../i18n";
import { retrySoundEvents, useSoundQueue } from "../services/soundEventQueue";
import "./SoundMonitoring.css";

export default function SoundMonitoringSettings() {
  const { t } = useTranslation();
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
    <p className="muted">{t("sound.limitation")}</p>
    <p className="muted">{t("sound.notAlarm")}</p>
    {failed && <div role="status"><p>{t("sound.saveError")}</p>
      <button type="button" className="secondary-button" onClick={() => void retrySoundEvents()}>{t("sound.retrySave")}</button>
    </div>}
  </section>;
}
