import { useId, useMemo, useState } from "react";
import { calculateSleepProbability } from "../../analytics/sleepProbability";
import type { ActiveSleep, SleepSession } from "../../analytics/types";
import { useTranslation } from "../../i18n";

export default function SleepProbabilityCard({ sessions, active, now, ageDays = null }: {
  sessions: SleepSession[]; active: ActiveSleep | null; now: number; ageDays?: number | null;
}) {
  const { t, locale } = useTranslation();
  const id = useId();
  const [selectedTime, setSelectedTime] = useState(() =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now),
  );
  const { weightedPercentage } = useMemo(
    () => calculateSleepProbability(sessions, selectedTime, now, active, ageDays),
    [sessions, selectedTime, now, active, ageDays],
  );

  return <section className="analysis-card sleep-probability-card" aria-labelledby={id + "-title"}>
    <h2 id={id + "-title"}>{t("sleepProbability.awakeTitle")}</h2>
    <div className="sleep-probability-time">
      <input type="time" aria-label={t("sleepProbability.localTime")} value={selectedTime}
        onChange={event => setSelectedTime(event.target.value)} />
      <p role="status" className={weightedPercentage === null ? "muted" : "sleep-probability-estimate"}>
        {!selectedTime ? null : weightedPercentage === null ? t("sleepProbability.awakeInsufficient") :
          t("sleepProbability.awakeEstimate", {
            percentage: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 })
              .format((100 - weightedPercentage) / 100),
          })}
      </p>
    </div>
  </section>;
}
