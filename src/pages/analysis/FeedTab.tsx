import {
  computeAtNightFeedPct,
  computeFeedDistribution,
  computeFeedsPerDayAvg,
  computeFeedsPerDayLast7,
  computeTypicalFeedInterval,
} from "../../analytics/feed";
import { dayKeyOf } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import { LOCALES, useTranslation, type Language } from "../../i18n";
import BarList, { type BarRow, type BarRowTone } from "../../components/analysis/BarList";
import KpiCard from "../../components/analysis/KpiCard";
import type { FeedDistributionLabel } from "../../analytics/feed";
import type { FeedEvent } from "../../analytics/types";

type Props = {
  feeds: FeedEvent[];
  now: number;
};

function dayBarLabel(dayKey: string, now: number, lang: Language, todayLabel: string): string {
  if (dayKey === dayKeyOf(now)) return todayLabel;

  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short" }).format(new Date(y, m - 1, d));
}

function toneForDistribution(label: FeedDistributionLabel): BarRowTone {
  return label === "left" || label === "right" ? "success" : "info";
}

export default function FeedTab({ feeds, now }: Props) {
  const { t, lang } = useTranslation();

  const distributionLabels: Record<FeedDistributionLabel, string> = {
    left: t("common.sideLeft"),
    right: t("common.sideRight"),
    both: t("common.sideBoth"),
    bottle: t("common.feedTypeBottle"),
    pumped: t("common.feedTypePumped"),
  };

  const feedsPerDayAvg = computeFeedsPerDayAvg(feeds, now);
  const interval = computeTypicalFeedInterval(feeds);
  const atNightPct = computeAtNightFeedPct(feeds);
  const perDay = computeFeedsPerDayLast7(feeds, now);
  const distribution = computeFeedDistribution(feeds);

  const todayLabel = t("common.today");

  const perDayRows: BarRow[] = perDay.map((day) => ({
    key: day.dayKey,
    label: dayBarLabel(day.dayKey, now, lang, todayLabel),
    pctOfMax: day.pctOfMax,
    valueText: day.count > 0 ? String(day.count) : "-",
  }));

  const totalFeeds = feeds.length;
  const distributionRows: BarRow[] = distribution.map((row) => {
    const maxCount = Math.max(...distribution.map((r) => r.count));
    return {
      key: row.label,
      label: distributionLabels[row.label],
      pctOfMax: maxCount > 0 ? (row.count / maxCount) * 100 : 0,
      valueText: String(row.count),
      detailText: `${Math.round(row.sharePct)}%`,
      tone: toneForDistribution(row.label),
    };
  });

  return (
    <div className="analysis-tab-content">
      <section className="stats-grid">
        <KpiCard
          label={t("analysis.feed.perDay")}
          value={feedsPerDayAvg != null ? feedsPerDayAvg.toFixed(1) : "-"}
        />
        <KpiCard
          label={t("analysis.feed.typicalInterval")}
          value={interval.medianMinutes != null ? formatDuration(interval.medianMinutes, lang) : "-"}
        />
        <KpiCard
          label={t("analysis.overview.atNight")}
          value={atNightPct != null ? `${Math.round(atNightPct)}%` : "-"}
        />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.overview.last7Days")}</p>
            <h2>{t("analysis.feed.perDay")}</h2>
          </div>
        </div>

        <BarList rows={perDayRows} emptyText={t("analysis.feed.noFeedingYet")} />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">{t("analysis.insight.distributionLabel")}</p>
            <h2>{t("analysis.feed.typeOfFeeding")}</h2>
          </div>
        </div>

        {totalFeeds === 0 ? (
          <div className="empty-card">{t("analysis.feed.noFeedingYet")}</div>
        ) : (
          <BarList rows={distributionRows} />
        )}
      </section>
    </div>
  );
}
