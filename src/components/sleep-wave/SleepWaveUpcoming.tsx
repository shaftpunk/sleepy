import { useId, useMemo } from "react";
import type { UpcomingDayForecast } from "../../analytics/dailySleepForecast";
import { buildUpcomingDayWaveModel, recordedWavePath } from "../../analytics/sleepWaveModel";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock } from "../../lib/format";

/* Preliminary forecast for the coming day, shown at night. It has its own
   explicit date and time axis, so it is never read as part of today's
   timeline, and every event is labelled as possible/preliminary. */
export default function SleepWaveUpcoming({ forecast }: { forecast: UpcomingDayForecast }) {
  const { t, lang } = useTranslation();
  const titleId = useId(), gradient = useId().replace(/:/g, "");
  const model = useMemo(() => buildUpcomingDayWaveModel(forecast), [forecast]);
  if (forecast.status === "not_applicable" || forecast.targetDayStartMs === null) return null;
  const date = new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short", day: "numeric", month: "short" }).format(forecast.targetDayStartMs);
  const range = (startMs: number, endMs: number) => `${formatClock(startMs, lang)}–${formatClock(endMs, lang)}`;
  return <section className="sleep-wave-upcoming" aria-labelledby={titleId}>
    <div className="sleep-wave-upcoming-head">
      <h3 id={titleId}>{t("sleepWave.upcomingTitle")}</h3>
      <span className="sleep-wave-today">{date} · {t("sleepWave.preliminaryShort")}</span>
    </div>
    <p className="sleep-wave-sr">{t("sleepWave.preliminary")}</p>
    {model && forecast.morningWake ? <>
      <div className="sleep-wave-upcoming-chart" aria-hidden="true">
        <svg viewBox="0 0 640 174" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`${gradient}-band`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--wave-band-core)" stopOpacity="0" />
              <stop offset=".5" stopColor="var(--wave-band-core)" stopOpacity=".35" />
              <stop offset="1" stopColor="var(--wave-light)" stopOpacity=".7" />
            </linearGradient>
            <linearGradient id={`${gradient}-wave`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--wave-light)" stopOpacity=".5" />
              <stop offset="1" stopColor="var(--wave-band-core)" stopOpacity=".15" />
            </linearGradient>
          </defs>
          {model.wake && <rect className="sleep-wave-upcoming-wake" x={model.wake.start * 640} y="96" width={(model.wake.end - model.wake.start) * 640} height="54" rx="10" />}
          {model.naps.map(nap => <g key={nap.sequenceIndex} style={{ opacity: Math.max(.45, .9 - (nap.sequenceIndex - 1) * .18) }}>
            <rect x={nap.onset.start * 640} y="64" width={(nap.onset.end - nap.onset.start) * 640} height="86" fill={`url(#${gradient}-band)`} />
            {nap.wave && <path className="sleep-wave-predicted" d={recordedWavePath(nap.wave)} fill={`url(#${gradient}-wave)`} />}
          </g>)}
          <line className="sleep-wave-baseline" x1="0" x2="640" y1="150" y2="150" />
        </svg>
        <div className="sleep-wave-axis">
          {model.ticks.map(tick => <span key={tick.instant} style={{ left: `${tick.position * 100}%` }}>{formatClock(tick.instant, lang)}</span>)}
        </div>
      </div>
      <ul className="sleep-wave-upcoming-list">
        <li><span>{t("sleepWave.upcomingWake")}</span><strong>{range(forecast.morningWake.earliestMs, forecast.morningWake.latestMs)}</strong></li>
        {forecast.predictedNaps.map(nap => <li key={nap.id}>
          <span>{t("sleepWave.upcomingNap", { n: nap.sequenceIndex })}</span><strong>{range(nap.onset.earliestMs, nap.onset.latestMs)}</strong>
        </li>)}
      </ul>
    </> : <p className="sleep-wave-upcoming-learning">{t("sleepWave.upcomingLearning")}</p>}
  </section>;
}
