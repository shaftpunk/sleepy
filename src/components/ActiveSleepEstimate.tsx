import { estimatedSleepProgress } from "../analytics/activeSleepEstimate";
import type { SleepEstimatePresentation } from "../services/sleepEstimateService";
import { useTranslation } from "../i18n";
import { formatClock } from "../lib/format";

type Props = { presentation: SleepEstimatePresentation; sleepStartedAt: string; now: number };

export default function ActiveSleepEstimate({ presentation, sleepStartedAt, now }: Props) {
  const { t, lang } = useTranslation();
  if (presentation.classification === "LONG_SLEEP_LIKE") {
    return <p className="sleep-subtitle" role="status">
      <span aria-hidden="true">☾ </span>{t("home.likelyNightSleep")}
    </p>;
  }
  if (presentation.classification !== "SHORT_SLEEP_LIKE" || !presentation.estimatedWakeTime) return null;
  const progress = estimatedSleepProgress(Date.parse(sleepStartedAt), Date.parse(presentation.estimatedWakeTime), now);
  if (!progress) return null;
  const remaining = progress.phase === "past" ? t("home.pastWakeEstimate") :
    progress.phase === "soon" ? t("home.wakingSoon") :
      t("home.estimatedNapRemaining", { minutes: new Intl.NumberFormat(lang === "no" ? "nb" : "en").format(progress.remainingMinutes) });
  const percentage = new Intl.NumberFormat(lang === "no" ? "nb" : "en", { style: "percent", maximumFractionDigits: 0 }).format(progress.progress);
  return <div className="active-sleep-estimate">
    <progress value={progress.progress} max={1} aria-label={t("home.estimatedNapProgress")} aria-valuetext={`${percentage}, ${remaining}`} />
    <p className="sleep-subtitle">{remaining}</p>
    <p className="sleep-subtitle home-wake-time">{t("home.estimatedWakeAround", { time: formatClock(Date.parse(presentation.estimatedWakeTime), lang) })}</p>
  </div>;
}
