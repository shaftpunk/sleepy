import { useState } from "react";
import { useTranslation } from "../i18n";
import MinuteWheel from "./MinuteWheel";
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
    <MinuteWheel value={value} disabled={disabled || saving} onChange={setValue} />
    {!valid && <p role="status">{t("sleepStart.invalid")}</p>}
    <button type="button" className="primary-button sleep-action" disabled={disabled || !valid}
      onClick={() => void onStart(minutes)}>
      {saving ? t("common.saving") : t("home.startSleep")}
    </button>
  </div>;
}
