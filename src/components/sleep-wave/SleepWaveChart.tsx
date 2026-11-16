import { useEffect, useId, useRef, useState } from "react";
import { recordedDisplaySegments, recordedWavePath, type SleepWaveModel } from "../../analytics/sleepWaveModel";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock } from "../../lib/format";

export default function SleepWaveChart({ model }: { model: SleepWaveModel }) {
  const id = useId().replace(/:/g, "");
  const { t, lang } = useTranslation();
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const recorded = recordedDisplaySegments(model.recorded, width, model.active ? [model.active] : []).map(recordedWavePath).join(" ");
  return <div ref={chartRef} className="sleep-wave-chart" aria-hidden="true">
    <div className="sleep-wave-now-label" style={{ left: `${model.now * 100}%` }}>{t("sleepWave.now")}</div>
    <svg viewBox="0 0 640 174" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id={`${id}-recorded`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="var(--wave-contour)" />
          <stop offset=".22" stopColor="var(--wave-record-top)" />
          <stop offset="1" stopColor="var(--wave-record-bottom)" />
        </linearGradient>
        <linearGradient id={`${id}-forecast`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--wave-forecast)" stopOpacity=".13" />
          <stop offset=".4" stopColor="var(--wave-forecast)" stopOpacity=".42" />
          <stop offset=".5" stopColor="var(--wave-light)" stopOpacity=".46" />
          <stop offset=".6" stopColor="var(--wave-forecast)" stopOpacity=".42" />
          <stop offset="1" stopColor="var(--wave-forecast)" stopOpacity=".13" />
        </linearGradient>
        <linearGradient id={`${id}-active`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--wave-light)" /><stop offset=".25" stopColor="var(--wave-active)" /><stop offset="1" stopColor="var(--wave-record-bottom)" />
        </linearGradient>
        <pattern id={`${id}-stripes`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" x2="0" y2="10" stroke="var(--wave-ink)" strokeOpacity=".24" strokeWidth="2" />
        </pattern>
      </defs>
      <line className="sleep-wave-baseline" x1="0" x2="640" y1="150" y2="150" />
      {recorded && <path className="sleep-wave-recorded" d={recorded} fill={`url(#${id}-recorded)`} />}
      {model.active && <g data-wave-active="true">
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-active)`} />
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-stripes)`} />
      </g>}
      {model.forecasts.map((forecast, i) => <g key={i} data-wave-forecast="onset">
        <rect x={forecast.start * 640} y="40" width={(forecast.end - forecast.start) * 640} height="110" fill={`url(#${id}-forecast)`} />
        <path className="sleep-wave-forecast-edge" d={`M ${forecast.start * 640} 150 V 44 H ${forecast.end * 640} V 150`} />
        <path className="sleep-wave-onset" d={`M ${forecast.likely * 640} 98 l 6 7 l -6 7 l -6 -7 Z`} />
      </g>)}
      <g className="sleep-wave-now-marker" style={{ transform: `translateX(${model.now * 640}px)` }}>
        <line y1="12" y2="150" />
        <circle className="sleep-wave-now-halo" cy="150" r="10" />
        <circle cy="150" r="3.5" />
      </g>
    </svg>
    <div className="sleep-wave-axis">
      {model.ticks.map((tick, index) => <span key={tick.instant} className={index === 0 ? "is-first" : index === model.ticks.length - 1 ? "is-last" : ""}
        style={{ left: `${tick.position * 100}%` }}>
        {formatClock(tick.instant, lang)}
        {tick.showDate && <small>{new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" }).format(tick.instant)}</small>}
        {tick.showOffset && <small>{new Intl.DateTimeFormat(LOCALES[lang], { timeZoneName: "shortOffset" }).formatToParts(tick.instant).find(p => p.type === "timeZoneName")?.value}</small>}
      </span>)}
    </div>
  </div>;
}
