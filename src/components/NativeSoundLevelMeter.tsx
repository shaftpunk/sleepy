// Presentation only: level already includes the existing dBFS mapping and
// attack/decay envelope. Do not smooth it again or generate synthetic samples.
export default function NativeSoundLevelMeter({ level, label }: { level: number; label: string }) {
  const value = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  return <div className="native-sound-meter" role="meter" aria-label={label}
    aria-valuemin={0} aria-valuemax={1} aria-valuenow={value}>
    <span className="native-sound-meter-fill" aria-hidden="true"
      style={{ transform: `translateZ(0) scaleX(${value})` }} />
  </div>;
}
