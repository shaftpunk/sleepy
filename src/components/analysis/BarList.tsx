import { useTranslation } from "../../i18n";

export type BarRowTone = "success" | "info" | "warning" | "neutral";

export type BarRow = {
  key: string;
  label: string;
  pctOfMax: number;
  valueText: string;
  detailText?: string;
  tone?: BarRowTone;
};

type Props = {
  rows: BarRow[];
  emptyText?: string;
};

export default function BarList({ rows, emptyText }: Props) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return <div className="empty-card">{emptyText ?? t("analysis.day.noSleepYet")}</div>;
  }

  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div className="bar-list-row" key={row.key}>
          <div className="bar-list-row-head">
            <span className="bar-list-label">{row.label}</span>
            <span className="bar-list-value">{row.valueText}</span>
          </div>

          <div className="bar-list-track">
            <div
              className={
                row.tone
                  ? `bar-list-fill ${row.tone}`
                  : "bar-list-fill"
              }
              style={{
                width: `${row.pctOfMax > 0 ? Math.max(row.pctOfMax, 4) : 0}%`,
              }}
            />
          </div>

          {row.detailText && (
            <span className="bar-list-detail">{row.detailText}</span>
          )}
        </div>
      ))}
    </div>
  );
}
