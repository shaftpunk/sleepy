type Props = {
  label: string;
  value: string;
  detail?: string;
};

export default function KpiCard({ label, value, detail }: Props) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
