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

  const napsStatus = compareToRange(rolling.napCount, guideline.napsMin, guideline.napsMax);

  const wakeWindowStatus = compareToRange(
    rolling.medianWakeWindowMinutes,
    guideline.wakeWindowMin,
    guideline.wakeWindowMax
  );

  return (
    <section className="analysis-card">
      <div className="analysis-card-heading">
        <div>
          <p className="card-label">{t("analysis.ageGuide.title")}</p>
          <h2>
            {t("analysis.ageGuide.monthRange", {
              min: guideline.minMonths,
              max: guideline.maxMonths,
            })}
          </h2>
        </div>
      </div>

      <p className="muted age-guide-current-age">
        {t("analysis.ageGuide.currentAge")}:{" "}
        {t("analysis.ageGuide.ageInDaysAndMonths", {
          days: ageDays ?? 0,
          months: Math.floor((ageDays ?? 0) / 30),
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
            <StatusChip status={napsStatus} label={statusLabel[napsStatus]} />
          </div>

          <div className="age-guide-metric-values">
            <strong>{rolling.napCount}</strong>
            <small>
              {t("analysis.ageGuide.typicalNaps")}: {guideline.napsMin}–{guideline.napsMax}
            </small>
          </div>
        </div>

        <div className="age-guide-metric-row">
          <div className="age-guide-metric-head">
            <span>{t("analysis.ageGuide.medianWakeWindowLabel")}</span>
            <StatusChip status={wakeWindowStatus} label={statusLabel[wakeWindowStatus]} />
          </div>

          <div className="age-guide-metric-values">
            <strong>
              {rolling.medianWakeWindowMinutes != null
                ? formatDuration(rolling.medianWakeWindowMinutes, lang)
                : "-"}
            </strong>
            <small>
              {t("analysis.ageGuide.typicalWakeWindow")}:{" "}
              {formatDuration(guideline.wakeWindowMin, lang)}–
              {formatDuration(guideline.wakeWindowMax, lang)}
            </small>
          </div>
        </div>
      </div>

      <p className="guidance-disclaimer">{t("common.guidanceDisclaimer")}</p>
    </section>
  );
}
