import { computeNightVsDayBreakdown, computeQualityDistribution, generateInsights } from "../../analytics/insights";
import { formatDuration, stars } from "../../lib/format";
import BarList, { type BarRow } from "../../components/analysis/BarList";
import { insightText } from "./insightText";
import type { SleepSession } from "../../analytics/types";

type Props = {
  sessions: SleepSession[];
  now: number;
};

export default function InsightTab({ sessions, now }: Props) {
  const quality = computeQualityDistribution(sessions);
  const nightVsDay = computeNightVsDayBreakdown(sessions);
  const insights = generateInsights(sessions, now);

  const qualityRows: BarRow[] = quality
    .filter((row) => row.count > 0)
    .map((row) => ({
      key: String(row.rating),
      label: stars(row.rating),
      pctOfMax: row.pctOfMax,
      valueText: String(row.count),
      detailText: `${Math.round(row.sharePct)}% av vurderte`,
    }));

  return (
    <div className="analysis-tab-content">
      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Vurderinger</p>
            <h2>Kvalitetsfordeling</h2>
          </div>
        </div>

        <BarList rows={qualityRows} emptyText="Ingen vurderte søvner ennå." />
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Fordeling</p>
            <h2>Natt vs. dagsøvn</h2>
          </div>
        </div>

        <div className="mini-stats">
          {nightVsDay.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{formatDuration(row.totalMinutes)}</strong>
              <small>
                {row.sessionCount} økter · {Math.round(row.sharePct)}%
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="analysis-card">
        <div className="analysis-card-heading">
          <div>
            <p className="card-label">Mønstre</p>
            <h2>Innsikt</h2>
          </div>
        </div>

        <div className="insight-list">
          {insights.map((insight, i) => (
            <p className="insight-row" key={`${insight.id}-${i}`}>
              {insightText(insight)}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
