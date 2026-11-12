import { useId, useMemo, useState } from "react";
import { calculateSleepProbability } from "../../analytics/sleepProbability";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { useTranslation } from "../../i18n";

export default function SleepProbabilityCard({ sessions, active, now }: {
  sessions: SleepSession[]; active: ActiveSleep | null; now: number;
}) {
  const { t, locale } = useTranslation();
  const id = useId();
  const [selectedTime, setSelectedTime] = useState("10:00");
  const result = useMemo(() => calculateSleepProbability(sessions, selectedTime, now, active), [sessions, selectedTime, now, active]);
  return <section className="analysis-card sleep-probability-card" aria-labelledby={id + "-title"}>
    <div className="analysis-card-heading">
      <h2 id={id + "-title"}>{t("sleepProbability.title")}</h2>
      <div className="sleep-probability-time">
        <label htmlFor={id}>{t("sleepProbability.localTime")}</label>
        <input id={id} type="time" step="900" required value={selectedTime}
          onChange={event => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) setSelectedTime(event.target.value); }} />
      </div>
    </div>
    <div role="status" aria-live="polite" aria-atomic="true">
      <p>{t("sleepProbability.atTime", { time: selectedTime })}</p>
      <p className="sleep-probability-count">{t("sleepProbability.recorded", { sleeping: result.sleepingDays, usable: result.usableDays })}</p>
      {result.weightedPercentage === null
        ? <p>{t("sleepProbability.insufficient")}</p>
        : <p className="sleep-probability-estimate">{t("sleepProbability.estimate", {
          percentage: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(result.weightedPercentage / 100),
        })}</p>}
    </div>
    <p className="muted">{t("sleepProbability.recency")}</p>
    <p className="muted">{t("sleepProbability.disclaimer")}</p>
    <details>
      <summary>{t("sleepProbability.usableTitle")}</summary>
      <p className="muted">{t("sleepProbability.usableRule")}</p>
    </details>
  </section>;
}
