import { Link } from "react-router-dom";

import { ageInDays } from "../../analytics/localDate";
import { compareToRange, getGuidelineForAgeDays } from "../../analytics/sleepGuidelines";
import { computeRolling24hStats } from "../../analytics/rolling24h";
import { formatDuration } from "../../lib/format";
import { useTranslation } from "../../i18n";
import StatusChip from "./StatusChip";
import type { ActiveSleep, SleepSession } from "../../analytics/types";

type Props = {
  birthDate: string | null;
  sessions: SleepSession[];
  active: ActiveSleep | null;
  now: number;
};

export default function AgeSleepGuideCard({ birthDate, sessions, active, now }: Props) {
  const { t, lang } = useTranslation();

  const ageDays = ageInDays(birthDate, now);
  const lookup = getGuidelineForAgeDays(ageDays);

  const statusLabel = {
    below: t("analysis.ageGuide.statusBelow"),
    within: t("analysis.ageGuide.statusWithin"),
    above: t("analysis.ageGuide.statusAbove"),
    "insufficient-data": t("common.notEnoughDataYet"),
  };

  if (lookup.status === "unknown") {
    return (
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.ageGuide.title")}</p>
            <h2>{t("analysis.ageGuide.noBirthDateTitle")}</h2>
          </div>
        </div>

        <p className="muted">{t("analysis.ageGuide.noBirthDateDescription")}</p>

        <Link to="/settings" className="secondary-button age-guide-settings-link">
          {t("common.goToSettings")}
        </Link>
      </section>
    );
  }

  if (lookup.status === "too-old") {
    return (
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.ageGuide.title")}</p>
            <h2>{t("analysis.ageGuide.tooOldTitle")}</h2>
          </div>
        </div>

        <p className="muted">{t("analysis.ageGuide.tooOldDescription")}</p>
      </section>
    );
  }

  const { guideline } = lookup;
  const rolling = computeRolling24hStats(sessions, active, now);

  const totalSleepStatus = compareToRange(
    rolling.totalSleepMinutes,
    guideline.totalSleepMin,
    guideline.totalSleepMax
  );

  const napsStatus =
    guideline.napsMin != null && guideline.napsMax != null
      ? compareToRange(rolling.napCount, guideline.napsMin, guideline.napsMax)
      : null;

  const wakeWindowStatus =
    guideline.wakeWindowMin != null && guideline.wakeWindowMax != null
      ? compareToRange(
          rolling.medianWakeWindowMinutes,
          guideline.wakeWindowMin,
          guideline.wakeWindowMax,
        )
      : null;

  const ageRange = t(
    guideline.ageUnit === "months"
      ? "analysis.ageGuide.monthRange"
      : "analysis.ageGuide.yearRange",
    { min: guideline.minAge, max: guideline.maxAge },
  );
  const approximateYears = Math.floor((ageDays ?? 0) / 365.2425);
  const approximateRemainingMonths = Math.max(
    0,
    Math.floor(((ageDays ?? 0) - approximateYears * 365.2425) / 30.44),
  );

  return (
    <section className="analysis-card">
      <div className="analysis-card-heading">
        <div>
          <p className="card-label">{t("analysis.ageGuide.title")}</p>
          <h2>
            {ageRange}
          </h2>
        </div>
      </div>

      <p className="muted age-guide-current-age">
        {t("analysis.ageGuide.currentAge")}:{" "}
        {(ageDays ?? 0) < 730
          ? t("analysis.ageGuide.ageInDaysAndMonths", {
              days: ageDays ?? 0,
              months: Math.floor((ageDays ?? 0) / 30),
            })
          : t("analysis.ageGuide.ageInYearsAndMonths", {
              years: approximateYears,
              months: approximateRemainingMonths,
            })}
      </p>

      <div className="age-guide-metric-rows">
        <div className="age-guide-metric-row">
          <div className="age-guide-metric-head">
            <span>{t("analysis.ageGuide.last24hSleep")}</span>
            <StatusChip status={totalSleepStatus} label={statusLabel[totalSleepStatus]} />
          </div>

          <div className="age-guide-metric-values">
            <strong>{formatDuration(rolling.totalSleepMinutes, lang)}</strong>
            <small>
              {t("analysis.ageGuide.typicalTotalSleep")}:{" "}
              {formatDuration(guideline.totalSleepMin, lang)}–
              {formatDuration(guideline.totalSleepMax, lang)}
            </small>
          </div>
        </div>

        <div className="age-guide-metric-row">
          <div className="age-guide-metric-head">
            <span>{t("analysis.ageGuide.napsLast24h")}</span>
            {napsStatus ? (
              <StatusChip status={napsStatus} label={statusLabel[napsStatus]} />
            ) : (
              <span className="trend-chip neutral">
                {t("analysis.ageGuide.noGeneralRange")}
              </span>
            )}
          </div>

          <div className="age-guide-metric-values">
            <strong>{rolling.napCount}</strong>
            <small>
              {t("analysis.ageGuide.typicalNaps")}: {guideline.napsMin != null && guideline.napsMax != null
                ? `${guideline.napsMin}–${guideline.napsMax}`
                : t("analysis.ageGuide.noGeneralRange")}
            </small>
          </div>
        </div>

        <div className="age-guide-metric-row">
          <div className="age-guide-metric-head">
            <span>{t("analysis.ageGuide.medianWakeWindowLabel")}</span>
            {wakeWindowStatus ? (
              <StatusChip status={wakeWindowStatus} label={statusLabel[wakeWindowStatus]} />
            ) : (
              <span className="trend-chip neutral">
                {t("analysis.ageGuide.noGeneralRange")}
              </span>
            )}
          </div>

          <div className="age-guide-metric-values">
            <strong>
              {rolling.medianWakeWindowMinutes != null
                ? formatDuration(rolling.medianWakeWindowMinutes, lang)
                : "-"}
            </strong>
            <small>
              {t("analysis.ageGuide.typicalWakeWindow")}:{" "}
              {guideline.wakeWindowMin != null && guideline.wakeWindowMax != null
                ? `${formatDuration(guideline.wakeWindowMin, lang)}–${formatDuration(
                    guideline.wakeWindowMax,
                    lang,
                  )}`
                : t("analysis.ageGuide.noGeneralRange")}
            </small>
          </div>
        </div>
      </div>

      <p className="guidance-disclaimer">
        {t("common.guidanceDisclaimer")} {t("analysis.ageGuide.sourceNote")}
      </p>
    </section>
  );
}
