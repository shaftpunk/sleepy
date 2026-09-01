import type { ComparisonStatus } from "../../analytics/sleepGuidelines";

type Props = {
  status: ComparisonStatus;
  label: string;
};

// Reuses the existing .trend-chip palette (green/amber/neutral) so the
// age-guide comparison never reaches for alarming red — "below"/"above" the
// typical range are just as calm as "within".
export default function StatusChip({ status, label }: Props) {
  const tone =
    status === "within" ? "positive" : status === "insufficient-data" ? "neutral" : "warning";

  return <span className={`trend-chip ${tone} status-chip`}>{label}</span>;
}
