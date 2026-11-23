import { useEffect, useState } from "react";
import { useAnalyticsData } from "../hooks/useAnalyticsData";
import { useNextSleepPrediction } from "../hooks/useNextSleepPrediction";
import { useTranslation } from "../i18n";
import { formatClock, formatSleepRange } from "../lib/format";

export default function SleepInsightsData({ babyId, birthDate }: { babyId: string; birthDate?: string | null }) {
  const { t, lang } = useTranslation();
  const { sessions, active, loading } = useAnalyticsData(babyId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("resume", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("resume", update);
    };
  }, []);
  const estimate = useNextSleepPrediction(sessions, active, now, birthDate);
  const confidence = estimate.confidence ?? "low";
  const { earliestStart, latestStart, peak, sampleSize } = estimate;
  const sleeping = active != null && active.startMs <= now;

  return <>
    {loading ? <p role="status">{t("common.loading")}</p> : <>
      <section className="sleep-insights-estimate">
        <h2>{t("home.nextSleepTitle")}</h2>
        {sleeping ? <p>{t("sleepWave.sleepingTitle")}</p>
          : estimate.status === "ready" && earliestStart != null && latestStart != null ? <>
            <p className="sleep-insights-estimate-time">{formatSleepRange(earliestStart, latestStart, now, lang)}</p>
            {peak && <p>{t("home.mostLikely", { time: formatClock(peak.peakTime, lang) })}</p>}
          </> : <p>{t("home.nextSleepLearning")}</p>}
      </section>
      {!sleeping && <>
        <section className="sleep-insights-data-row">
          <h2>{t("sleepInsights.basis")}</h2>
          <strong>{t(`sleepInsights.evidence.${confidence}`)}</strong>
          {sampleSize > 0 && <div>
            <p>{t(sampleSize === 1 ? "sleepInsights.oneSample" : "sleepInsights.samples", { count: sampleSize })}</p>
            <p>{t("sleepInsights.recency")}</p>
          </div>}
        </section>
        <section className="sleep-insights-data-row">
          <h2>{t("sleepInsights.patternTitle")}</h2>
          <strong>{t(`sleepInsights.pattern.${estimate.pattern ?? "learning"}`)}</strong>
        </section>
      </>}
    </>}
    <section className="sleep-insights-data-row">
      <h2>{t("sleepInsights.accuracy")}</h2>
      <div>
        <strong>{t("sleepInsights.accuracyPending")}</strong>
        <p>{t("sleepInsights.accuracyDescription")}</p>
      </div>
    </section>
    <details className="sleep-insights-help">
      <summary>{t("sleepInsights.how")}</summary>
      <p>{t("sleepInsights.explanation")}</p>
    </details>
  </>;
}
