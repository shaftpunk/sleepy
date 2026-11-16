import { useEffect, useId, useRef, useState } from "react";
import { recordedDisplaySegments, recordedWaveCrest, recordedWavePath, type SleepWaveModel } from "../../analytics/sleepWaveModel";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock } from "../../lib/format";

// Geometry shared by the SVG (viewBox 0 0 640 174, baseline y=150) and the HTML
// labels layered over it. Labels are positioned from the same timestamps.
const LABEL_SPACE = 40, CHART_HEIGHT = 116;
const toPx = (units: number) => LABEL_SPACE + units / 174 * CHART_HEIGHT;
// Decorative ground mist under the baseline: fixed shapes, never data.
const MIST_BACK = "M 0 152 C 90 142 170 158 270 149 S 450 140 540 150 S 615 156 640 148 L 640 174 L 0 174 Z";
const MIST_FRONT = "M 0 156 C 110 150 200 162 320 154 S 500 148 640 157 L 640 174 L 0 174 Z";

type Label = { key: string; text: string; x: number; top: number; width: number; kind: "forecast" | "recorded" };

export default function SleepWaveChart({ model, now, formatRange }: {
  model: SleepWaveModel; now: number; formatRange: (startMs: number, endMs: number) => string;
}) {
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
  const displayed = recordedDisplaySegments(model.recorded, width, model.active ? [model.active] : []);
  const recorded = displayed.map(recordedWavePath).join(" ");

  // Time labels above the forecast band and recorded peaks (most recent first),
  // dropped rather than overlapped when space is short. Text is the true range.
  const labels: Label[] = [];
  if (width > 0) {
    const nowX = model.now * width;
    const candidates: (Omit<Label, "x" | "width"> & { center: number })[] = [
      ...model.forecasts.map((f, i) => ({ key: `f${i}`, kind: "forecast" as const, text: formatRange(f.startMs, f.endMs),
        top: toPx(52) - 22, center: (f.start + f.end) / 2 })),
      ...displayed.map((s, i) => ({ key: `r${i}`, kind: "recorded" as const, text: formatRange(model.recorded[i].startMs, model.recorded[i].endMs),
        top: toPx(recordedWaveCrest(s)) - 20, center: (s.start + s.end) / 2 })).reverse(),
    ];
    for (const candidate of candidates) {
      const labelWidth = candidate.text.length * 6.6 + 12;
      if (labelWidth > width) continue;
      const x = Math.min(width - labelWidth / 2, Math.max(labelWidth / 2, candidate.center * width));
      const clashes = labels.some(l => Math.abs(l.x - x) < (l.width + labelWidth) / 2 + 6 && Math.abs(l.top - candidate.top) < 20)
        || (candidate.top < LABEL_SPACE && Math.abs(nowX - x) < labelWidth / 2 + 28);
      if (!clashes) labels.push({ key: candidate.key, kind: candidate.kind, text: candidate.text, top: candidate.top, x, width: labelWidth });
    }
  }

  return <div ref={chartRef} className="sleep-wave-chart" aria-hidden="true" style={{ paddingTop: LABEL_SPACE }}>
    <div className="sleep-wave-now-label" style={{ left: `${model.now * 100}%` }}>
      <span>{t("sleepWave.now")}</span><time>{formatClock(now, lang)}</time>
    </div>
    {labels.map(label => <span key={label.key} className={`sleep-wave-peak-label is-${label.kind}`}
      style={{ left: label.x, top: label.top }}>{label.text}</span>)}
    <svg viewBox="0 0 640 174" preserveAspectRatio="none" focusable="false" style={{ height: CHART_HEIGHT }}>
      <defs>
        <linearGradient id={`${id}-recorded`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="var(--wave-contour)" />
          <stop offset=".14" stopColor="var(--wave-record-top)" />
          <stop offset=".48" stopColor="var(--wave-forecast)" stopOpacity=".7" />
          <stop offset="1" stopColor="var(--wave-record-bottom)" />
        </linearGradient>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-band-core)" stopOpacity="0" />
          <stop offset=".35" stopColor="var(--wave-band-core)" stopOpacity=".42" />
          <stop offset=".8" stopColor="var(--wave-light)" stopOpacity=".7" />
          <stop offset="1" stopColor="var(--wave-light)" stopOpacity=".85" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="var(--wave-light)" stopOpacity=".7" />
          <stop offset=".5" stopColor="var(--wave-band-core)" stopOpacity=".24" />
          <stop offset="1" stopColor="var(--wave-band-core)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-mist`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-mist)" stopOpacity="0" />
          <stop offset=".22" stopColor="var(--wave-mist)" stopOpacity=".6" />
          <stop offset="1" stopColor="var(--wave-mist)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-active`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--wave-light)" /><stop offset=".25" stopColor="var(--wave-active)" /><stop offset="1" stopColor="var(--wave-record-bottom)" />
        </linearGradient>
        <clipPath id={`${id}-sky`}><rect width="640" height="150" /></clipPath>
        <pattern id={`${id}-stripes`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" x2="0" y2="10" stroke="var(--wave-ink)" strokeOpacity=".24" strokeWidth="2" />
        </pattern>
      </defs>
      <path className="sleep-wave-mist" d={MIST_BACK} fill={`url(#${id}-mist)`} />
      {model.forecasts.map((forecast, i) => {
        const x0 = forecast.start * 640, x1 = forecast.end * 640, mid = (x0 + x1) / 2;
        return <g key={i} data-wave-forecast="onset">
          <ellipse className="sleep-wave-band-glow" cx={mid} cy="150" rx={(x1 - x0) / 2 + 34} ry="80" fill={`url(#${id}-glow)`} clipPath={`url(#${id}-sky)`} />
          <path className="sleep-wave-band" d={`M ${x0} 150 V 62 Q ${x0} 52 ${mid} 52 Q ${x1} 52 ${x1} 62 V 150 Z`} fill={`url(#${id}-band)`} />
          <path className="sleep-wave-forecast-edge" d={`M ${x0} 150 V 60 M ${x1} 150 V 60`} />
          <path className="sleep-wave-onset" d={`M ${forecast.likely * 640} 150 V 104`} />
        </g>;
      })}
      <line className="sleep-wave-baseline" x1="0" x2="640" y1="150" y2="150" />
      {recorded && <path className="sleep-wave-recorded" d={recorded} fill={`url(#${id}-recorded)`} />}
      {model.active && <g data-wave-active="true">
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-active)`} />
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-stripes)`} />
      </g>}
      <path className="sleep-wave-mist is-front" d={MIST_FRONT} fill={`url(#${id}-mist)`} />
      <g className="sleep-wave-now-marker" style={{ transform: `translateX(${model.now * 640}px)` }}>
        <line y1="0" y2="150" />
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
