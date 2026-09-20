import { useState } from "react";
import { useTranslation } from "../i18n";
import "./SleepStartOptions.css";

export default function SleepStopOptions({ disabled, saving, onStop }: {
  disabled: boolean; saving: boolean; onStop: (minutesAgo: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("0");
  const minutes = Number(value);
  const valid = /^\d+$/.test(value) && Number.isSafeInteger(minutes) && minutes >= 0;
  return <div className="sleep-start-options">
    <p>{t("sleepStop.question")}</p>
    <div className="sleep-start-presets" role="group" aria-label={t("sleepStop.question")}>
      {[0, 5, 10, 15, 20].map((amount) => <button key={amount} type="button"
        className="secondary-button" disabled={disabled}
        aria-pressed={valid && minutes === amount} onClick={() => setValue(String(amount))}>
        {amount === 0 ? t("sleepStop.now") : t("sleepStart.preset", { minutes: amount })}
      </button>)}
    </div>
    <label className="sleep-start-custom">
      <span>{t("sleepStop.custom")}</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={value}
        disabled={disabled} aria-invalid={!valid} onChange={(event) => setValue(event.target.value)} />
    </label>
    {!valid && <p role="status">{t("sleepStart.invalid")}</p>}
    <button type="button" className="primary-button sleep-action is-sleeping" disabled={disabled || !valid}
      onClick={() => void onStop(minutes)}>
      {!saving && (
        <span className="sleep-action-zzz" aria-hidden="true">
          <span>z</span><span>Z</span><span>z</span>
        </span>
      )}
      <span>{saving ? t("common.saving") : t("home.stopSleep")}</span>
    </button>
  </div>;
}
