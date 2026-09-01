import { computePersonalSleepProfile } from "../../analytics/personalSleepProfile";
import { computeSleepPrediction, type PredictionBasisEntry } from "../../analytics/sleepPrediction";
import { formatClock, formatDuration } from "../../lib/format";
import { useTranslation, type TranslationKey } from "../../i18n";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  active: ActiveSleep | null;
  now: number;
  ageDays: number | null;
};

const CONFIDENCE_KEYS: Record<string, TranslationKey> = {
  low: "common.confidenceLow",
  medium: "common.confidenceMedium",
  high: "common.confidenceHigh",
};

function basisText(
  entry: PredictionBasisEntry,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  switch (entry.id) {
    case "age-guideline":
      return t("analysis.prediction.basisAgeGuideline");
    case "time-of-day-pattern":
      return t("analysis.prediction.basisTimeOfDayPattern");
    case "personal-pattern":
      return t("analysis.prediction.basisPersonalPattern", { days: entry.days ?? 0 });
    case "limited-history":
      return t("analysis.prediction.basisLimitedHistory", { days: entry.days ?? 0 });
    default:
      return "";
  }
}

export default function NextSleepPredictionCard({ sessions, active, now, ageDays }: Props) {
  const { t, lang } = useTranslation();

  const profile = computePersonalSleepProfile(sessions, now);
  const result = computeSleepPrediction({ sessions, active, now, ageDays, profile });

  if (result.status === "sleeping") {
    return (
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.prediction.title")}</p>
            <h2>{t("analysis.prediction.sleepingNowTitle")}</h2>
          </div>
        </div>

        <p className="muted">{t("analysis.prediction.sleepingNowDescription")}</p>
      </section>
    );
  }

  if (result.status === "unavailable") {
    return (
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.prediction.title")}</p>
            <h2>{t("analysis.prediction.unavailableTitle")}</h2>
          </div>
        </div>

        <p className="muted">{t("analysis.prediction.unavailableDescription")}</p>
      </section>
    );
  }

  const { prediction } = result;

  return (
    <section className="analysis-card">
      <div className="analysis-card-heading">
        <div>
          <p className="card-label">{t("analysis.prediction.title")}</p>
          <h2>
            {formatClock(prediction.earliestSleepMs, lang)}–
            {formatClock(prediction.latestSleepMs, lang)}
          </h2>
        </div>

        <span className="trend-chip neutral">{t(CONFIDENCE_KEYS[prediction.confidence])}</span>
      </div>

      <p className="muted prediction-based-on-label">{t("analysis.prediction.basedOn")}</p>

      <ul className="prediction-basis-list">
        <li>{t("analysis.prediction.lastWakeUpAt", { time: formatClock(prediction.lastWakeMs, lang) })}</li>

        {prediction.basis.map((entry, i) => (
          <li key={`${entry.id}-${i}`}>{basisText(entry, t)}</li>
        ))}
      </ul>

      <p className="muted">
        {t("analysis.prediction.estimatedWakeWindow", {
          duration: formatDuration(prediction.wakeWindowMinutes, lang),
        })}
      </p>

      <p className="guidance-disclaimer">{t("common.guidanceDisclaimer")}</p>
    </section>
  );
}
