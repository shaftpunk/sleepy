import { useState } from "react";
import { useTranslation } from "../i18n";
import "./SleepStartOptions.css";

export default function SleepStartOptions({ disabled, saving, onStart }: {
  disabled: boolean; saving: boolean; onStart: (minutesAgo: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("0");
  const minutes = Number(value);
  const valid = /^\d+$/.test(value) && Number.isSafeInteger(minutes) && minutes >= 0;
  return <div className="sleep-start-options">
    <p>{t("sleepStart.question")}</p>
    <div className="sleep-start-presets" role="group" aria-label={t("sleepStart.question")}>
      {[0, 5, 10, 15, 20].map((amount) => <button key={amount} type="button"
        className="secondary-button" disabled={disabled}
        aria-pressed={valid && minutes === amount} onClick={() => setValue(String(amount))}>
        {amount === 0 ? t("sleepStart.now") : t("sleepStart.preset", { minutes: amount })}
      </button>)}
    </div>
    <label className="sleep-start-custom">
      <span>{t("sleepStart.custom")}</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={value}
        disabled={disabled} aria-invalid={!valid} onChange={(event) => setValue(event.target.value)} />
    </label>
    {!valid && <p role="status">{t("sleepStart.invalid")}</p>}
    <button type="button" className="primary-button sleep-action" disabled={disabled || !valid}
      onClick={() => void onStart(minutes)}>
      {saving ? t("common.saving") : t("home.startSleep")}
    </button>
  </div>;
}
