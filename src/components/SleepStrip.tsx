import { useEffect, useState } from "react";

import { computeSleepStrip } from "../analytics/home";
import { formatClock, formatDuration } from "../lib/format";
import type { ActiveSleep, SleepSession } from "../analytics/types";

type Props = {
  sessions: SleepSession[];
  active: ActiveSleep | null;
};

const MINUTE_MS = 60000;

export default function SleepStrip({ sessions, active }: Props) {
  const [now, setNow] = useState(() => Date.now());

  // Redrawn on the minute boundary, not every second.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(interval);
  }, []);

  const cells = computeSleepStrip(sessions, active, now);
  const sleepCells = cells.filter((c) => c.isSleep).length;
  const sleepMinutes = sleepCells * 10;
  const pct = Math.round((sleepCells / cells.length) * 100);

  return (
    <div className="sleep-strip">
      <div className="sleep-strip-grid">
        {cells.map((cell) => (
          <div
            key={cell.startMs}
            className={
              cell.isSleep ? "sleep-strip-cell sleep" : "sleep-strip-cell"
            }
            title={`${formatClock(cell.startMs)} – ${formatClock(cell.endMs)}: ${
              cell.isSleep ? "Sleep" : "No recorded sleep"
            }`}
          />
        ))}
      </div>

      <div className="sleep-strip-summary">
        <span>
          {formatDuration(sleepMinutes)} sleep ({pct}%)
        </span>

        <span className="sleep-strip-times">
          {formatClock(cells[0]?.startMs ?? now)} – {formatClock(now)}
        </span>
      </div>
    </div>
  );
}
