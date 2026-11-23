import { useSleepForecasts } from "../../hooks/useSleepForecasts";
import { formatClock } from "../../lib/format";
import { useTranslation, type TranslationKey } from "../../i18n";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  active: ActiveSleep | null;
  now: number;
  birthDate: string | null;
};

const CONFIDENCE_KEYS: Record<string, TranslationKey> = {
  low: "common.confidenceLow",
  medium: "common.confidenceMedium",
  high: "common.confidenceHigh",
};

export default function NextSleepPredictionCard({ sessions, active, now, birthDate }: Props) {
  const { t, lang } = useTranslation();

  const { nextSleep: result } = useSleepForecasts({ sessions, active, now, birthDate });

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

  if (result.status !== "ready" || result.earliestStart == null || result.latestStart == null) {
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



  return (
    <section className="analysis-card">
      <div className="analysis-card-heading">
        <div>
          <p className="card-label">{t("analysis.prediction.title")}</p>
          <h2>
            {formatClock(result.earliestStart, lang)}â€“
            {formatClock(result.latestStart, lang)}
          </h2>
        </div>

        <span className="trend-chip neutral">{t(CONFIDENCE_KEYS[result.confidence ?? "low"])}</span>
      </div>

      <p className="muted">{t("analysis.prediction.recentSequence")}</p>

      <p className="guidance-disclaimer">{t("common.guidanceDisclaimer")}</p>
    </section>
  );
}
