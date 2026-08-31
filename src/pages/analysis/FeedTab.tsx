import {
  computeAtNightFeedPct,
  computeFeedDistribution,
  computeFeedsPerDayAvg,
  computeFeedsPerDayLast7,
  computeTypicalFeedInterval,
} from "../../analytics/feed";
import { dayKeyOf } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import BarList, { type BarRow, type BarRowTone } from "../../components/analysis/BarList";
import KpiCard from "../../components/analysis/KpiCard";
import type { FeedEvent } from "../../analytics/types";

type Props = {
  feeds: FeedEvent[];
  now: number;
};

function dayBarLabel(dayKey: string, now: number): string {
  if (dayKey === dayKeyOf(now)) return "I dag";

  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { weekday: "short" }).format(new Date(y, m - 1, d));
}

const DISTRIBUTION_LABELS: Record<string, string> = {
  venstre: "Venstre",
  høyre: "Høyre",
  begge: "Begge",
  flaske: "Flaske",
  pumpet: "Pumpet",
};

function toneForDistribution(label: string): BarRowTone {
  return label === "venstre" || label === "høyre" ? "success" : "info";
}

export default function FeedTab({ feeds, now }: Props) {
  const feedsPerDayAvg = computeFeedsPerDayAvg(feeds, now);
  const interval = computeTypicalFeedInterval(feeds);
  const atNightPct = computeAtNightFeedPct(feeds);
  const perDay = computeFeedsPerDayLast7(feeds, now);
  const distribution = computeFeedDistribution(feeds);

  const perDayRows: BarRow[] = perDay.map((day) => ({
    key: day.dayKey,
    label: dayBarLabel(day.dayKey, now),
    pctOfMax: day.pctOfMax,
    valueText: day.count > 0 ? String(day.count) : "-",
  }));

  const totalFeeds = feeds.length;
  const distributionRows: BarRow[] = distribution.map((row) => {
    const maxCount = Math.max(...distribution.map((r) => r.count));
    return {
      key: row.label,
      label: DISTRIBUTION_LABELS[row.label],
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
          label="Mating per dag"
          value={feedsPerDayAvg != null ? feedsPerDayAvg.toFixed(1) : "-"}
        />
        <KpiCard
          label="Typisk intervall"
          value={interval.medianMinutes != null ? formatDuration(interval.medianMinutes) : "-"}
        />
        <KpiCard
          label="Om natten"
          value={atNightPct != null ? `${Math.round(atNightPct)}%` : "-"}
        />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Siste 7 dager</p>
            <h2>Mating per dag</h2>
          </div>
        </div>

        <BarList rows={perDayRows} emptyText="Ingen mating registrert ennå." />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Fordeling</p>
            <h2>Type mating</h2>
          </div>
        </div>

        {totalFeeds === 0 ? (
          <div className="empty-card">Ingen mating registrert ennå.</div>
        ) : (
          <BarList rows={distributionRows} />
        )}
      </section>
    </div>
  );
}
