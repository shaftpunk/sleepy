import { computePersonalSleepProfile } from "../../analytics/personalSleepProfile";
import { minutesToClockLabel } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { useTranslation, type TranslationKey } from "../../i18n";
import type { SleepGuideline } from "../../analytics/sleepGuidelines";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  guideline: SleepGuideline | null;
  now: number;
};

const CONFIDENCE_KEYS: Record<string, TranslationKey> = {
  low: "common.confidenceLow",
  medium: "common.confidenceMedium",
  high: "common.confidenceHigh",
};

export default function PersonalSleepProfileCard({ sessions, guideline, now }: Props) {
  const { t, lang } = useTranslation();

  const profile = computePersonalSleepProfile(sessions, now);
  const hasData = profile.averageTotalSleepPerDay != null;

  return (
    <section className="analysis-card">
      <div className="analysis-card-heading">
        <div>
          <p className="card-label">{t("analysis.personalProfile.title")}</p>
          <h2>
            {t("common.daysCount", { count: profile.historyDays })} ·{" "}
            {t("analysis.personalProfile.historyAvailable")}
          </h2>
        </div>

        {hasData && (
          <span className="trend-chip neutral">{t(CONFIDENCE_KEYS[profile.confidence])}</span>
        )}
      </div>

      <p className="muted">{t("analysis.personalProfile.description")}</p>

      {!hasData ? (
        <div className="empty-card">{t("analysis.personalProfile.notEnoughData")}</div>
      ) : (
        <>
          <div className="mini-stats">
            <div>
              <span>{t("analysis.personalProfile.avgSleepPerDay")}</span>
              <strong>{formatDuration(profile.averageTotalSleepPerDay ?? 0, lang)}</strong>
            </div>

            <div>
              <span>{t("analysis.personalProfile.avgNapsPerDay")}</span>
              <strong>
                {profile.averageNapCountPerDay != null
                  ? profile.averageNapCountPerDay.toFixed(1)
                  : "-"}
              </strong>
            </div>

            <div>
              <span>{t("analysis.personalProfile.medianWakeWindow")}</span>
              <strong>
                {profile.medianWakeWindow != null
                  ? formatDuration(profile.medianWakeWindow, lang)
                  : "-"}
              </strong>
            </div>

            <div>
              <span>{t("analysis.personalProfile.typicalBedtime")}</span>
              <strong>
                {profile.typicalBedtime != null ? minutesToClockLabel(profile.typicalBedtime) : "-"}
              </strong>
            </div>

            <div>
              <span>{t("analysis.personalProfile.typicalWakeTime")}</span>
              <strong>
                {profile.typicalWakeTime != null ? minutesToClockLabel(profile.typicalWakeTime) : "-"}
              </strong>
            </div>
          </div>

          {guideline && profile.medianWakeWindow != null && (
            <div className="personal-vs-guideline">
              <div>
                <span>{t("analysis.personalProfile.comparisonAgeLabel")}</span>
                <strong>
                  {formatDuration(guideline.wakeWindowMin, lang)}–
                  {formatDuration(guideline.wakeWindowMax, lang)}
                </strong>
              </div>

              <div>
                <span>
                  {t("analysis.personalProfile.comparisonPersonalLabel", {
                    days: profile.historyDays,
                  })}
                </span>
                <strong>{formatDuration(profile.medianWakeWindow, lang)}</strong>
              </div>
            </div>
          )}

          <p className="muted personal-profile-note">{t("analysis.personalProfile.observedNote")}</p>
        </>
      )}
    </section>
  );
}
