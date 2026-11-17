import { useEffect, useId, useRef, useState } from "react";
import { recordedDisplaySegments, recordedWaveCrest, recordedWavePath, type SleepWaveModel } from "../../analytics/sleepWaveModel";
import { LOCALES, useTranslation } from "../../i18n";
import { formatClock } from "../../lib/format";

// Geometry shared by the SVG (viewBox 0 0 640 174, baseline y=150) and the HTML
// labels layered over it. Labels are positioned from the same timestamps.
const LABEL_SPACE = 40, CHART_HEIGHT = 136;
const toPx = (units: number) => LABEL_SPACE + units / 174 * CHART_HEIGHT;
// Decorative rolling ground around the baseline: fixed shapes, never data. The
// back swell sits behind every sleep shape; the front ones stay at or below
// the baseline so they never hide recorded sleep.
const SWELL_BACK = "M 0 143 C 60 131 140 150 230 141 S 390 127 470 139 S 585 149 640 134 L 640 174 L 0 174 Z";
const SWELL_MID = "M 0 152 C 90 146 170 158 270 150 S 450 148 540 151 S 615 156 640 149 L 640 174 L 0 174 Z";
const SWELL_FRONT = "M 0 158 C 110 152 200 164 320 156 S 500 151 640 160 L 640 174 L 0 174 Z";

type Label = { key: string; text: string; x: number; top: number; width: number; kind: "forecast" | "later" | "recorded" };
// A soft, wider hill of light under a wave, like the approved artwork. It is
// blurred decoration only: the crisp wave drawn on top keeps the true times.
const hill = ({ start, end }: { start: number; end: number }, crest: number) => {
  const c = (start + end) / 2 * 640, r = Math.max((end - start) * 640 * 2.2, 52), h = 150 - (150 - crest) * .6;
  return `M ${c - r} 150 C ${c - r * .45} 150 ${c - r * .42} ${h} ${c} ${h} C ${c + r * .42} ${h} ${c + r * .45} 150 ${c + r} 150 Z`;
};
// Later forecast events fade with horizon; emphasis never grows further ahead.
const laterOpacity = (sequenceIndex: number) => Math.max(.38, .98 - (sequenceIndex - 1) * .28);

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
      ...model.predicted.filter(p => !p.isNext).map(p => ({ key: `p${p.sequenceIndex}`, kind: "later" as const,
        text: formatRange(p.onset.startMs, p.onset.endMs), top: toPx(p.wave ? recordedWaveCrest(p.wave) : 58) - 20, center: (p.onset.start + p.onset.end) / 2 })),
      ...displayed.map((s, i) => ({ key: `r${i}`, kind: "recorded" as const, text: formatRange(model.recorded[i].startMs, model.recorded[i].endMs),
        top: toPx(recordedWaveCrest(s)) - 20, center: (s.start + s.end) / 2 })).reverse(),
    ];
    // Sleep in the condensed night keeps its true times, set in the open sky
    // above it (clock times only: the dusk shade already says "last night").
    const night = model.compressed;
    if (night) displayed.forEach((_, i) => {
      const record = model.recorded[i], candidate = candidates.find(c => c.key === `r${i}`);
      if (!candidate || record.endMs > night.endMs || record.endMs - record.startMs < 3 * 3600000) return;
      candidate.text = `${formatClock(record.startMs, lang)}–${formatClock(record.endMs, lang)}`;
      candidate.top = LABEL_SPACE + 2;
      candidates.splice(candidates.findIndex(c => c.kind === "recorded"), 0, ...candidates.splice(candidates.indexOf(candidate), 1));
    });
    for (const candidate of candidates) {
      const labelWidth = candidate.text.length * 6.6 + 12;
      if (labelWidth > width) continue;
      let x = Math.min(width - labelWidth / 2, Math.max(labelWidth / 2, candidate.center * width));
      // Keep the text clear of the now line: nudge it to the side its event is on.
      if (Math.abs(nowX - x) < labelWidth / 2 + 3) {
        const side = candidate.center * width >= nowX ? 1 : -1, moved = nowX + side * (labelWidth / 2 + 4);
        if (moved >= labelWidth / 2 && moved <= width - labelWidth / 2) x = moved;
      }
      const clashes = labels.some(l => Math.abs(l.x - x) < (l.width + labelWidth) / 2 + 6 && Math.abs(l.top - candidate.top) < 20)
        || (candidate.top < LABEL_SPACE && Math.abs(nowX - x) < labelWidth / 2 + 28);
      if (!clashes) labels.push({ key: candidate.key, kind: candidate.kind, text: candidate.text, top: candidate.top, x, width: labelWidth });
    }
  }

  // Whole-hour axes read as "06 09 12"; other clock formats keep every other tick.
  const tickLabels = model.ticks.map(tick => formatClock(tick.instant, lang));
  const compact = tickLabels.length > 4 && tickLabels.every(label => /^[0-9]{2}[:.]00$/.test(label));
  const sparse = tickLabels.length > 4 && !compact;
  const nextWave = model.predicted.find(p => p.isNext && p.wave)?.wave;

  return <div ref={chartRef} className="sleep-wave-chart" aria-hidden="true" style={{ paddingTop: LABEL_SPACE }}>
    <div className="sleep-wave-now-label" style={{ left: `${model.now * 100}%` }}>
      <span>{t("sleepWave.now")}</span><time>{formatClock(now, lang)}</time>
    </div>
    {labels.map(label => <span key={label.key} className={`sleep-wave-peak-label is-${label.kind}`}
      style={{ left: label.x, top: label.top }}>{label.text}</span>)}
    <svg viewBox="0 0 640 174" preserveAspectRatio="none" focusable="false" style={{ height: CHART_HEIGHT }}>
      <defs>
        <linearGradient id={`${id}-recorded`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-record-light, var(--wave-record-top))" />
          <stop offset=".18" stopColor="var(--wave-record-top)" />
          <stop offset=".55" stopColor="var(--wave-record-mid, var(--wave-record-top))" />
          <stop offset="1" stopColor="var(--wave-record-bottom)" />
        </linearGradient>
        <linearGradient id={`${id}-next`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-crest)" />
          <stop offset=".4" stopColor="var(--wave-band-core)" stopOpacity=".9" />
          <stop offset="1" stopColor="var(--wave-forecast)" stopOpacity=".5" />
        </linearGradient>
        <linearGradient id={`${id}-swell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-crest)" stopOpacity=".85" />
          <stop offset=".3" stopColor="var(--wave-mist)" stopOpacity=".5" />
          <stop offset="1" stopColor="var(--wave-mist)" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-sky`}><rect width="640" height="150" /></clipPath>
        <radialGradient id={`${id}-night`}>
          <stop offset="0" stopColor="var(--wave-night)" stopOpacity=".6" />
          <stop offset=".55" stopColor="var(--wave-night)" stopOpacity=".3" />
          <stop offset="1" stopColor="var(--wave-night)" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="15 9" /></filter>
        <filter id={`${id}-hill`} x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="8 5" /></filter>
        <linearGradient id={`${id}-hillfill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-halo-tint)" stopOpacity=".72" />
          <stop offset="1" stopColor="var(--wave-halo-tint)" stopOpacity=".18" />
        </linearGradient>
        <filter id={`${id}-feather`} x="-200%" y="-20%" width="500%" height="140%"><feGaussianBlur stdDeviation="5 2" /></filter>
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
        <linearGradient id={`${id}-active`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--wave-light)" /><stop offset=".25" stopColor="var(--wave-active)" /><stop offset="1" stopColor="var(--wave-record-bottom)" />
        </linearGradient>
        <linearGradient id={`${id}-predicted`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--wave-light)" stopOpacity=".55" />
          <stop offset=".45" stopColor="var(--wave-band-core)" stopOpacity=".38" />
          <stop offset="1" stopColor="var(--wave-band-core)" stopOpacity=".12" />
        </linearGradient>
        <radialGradient id={`${id}-inner`} cx="50%" cy="12%" r="85%">
          <stop stopColor="var(--wave-crest)" stopOpacity=".62" /><stop offset=".38" stopColor="var(--wave-light)" stopOpacity=".18" /><stop offset="1" stopColor="var(--wave-crest)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--wave-now)" stopOpacity=".12" /><stop offset="1" stopColor="var(--wave-now)" stopOpacity=".9" /></linearGradient>
        <pattern id={`${id}-stripes`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" x2="0" y2="10" stroke="var(--wave-ink)" strokeOpacity=".24" strokeWidth="2" />
        </pattern>
      </defs>
      {model.compressed && <g data-wave-compressed="true">
        <ellipse className="sleep-wave-night-shade" clipPath={`url(#${id}-sky)`} cx={model.compressed.end * 320} cy="150" rx={model.compressed.end * 520} ry="118" fill={`url(#${id}-night)`} />
        <path className="sleep-wave-night-break" d={`M ${model.compressed.end * 640 - 7} 158 l 6 -16 M ${model.compressed.end * 640 + 1} 158 l 6 -16`} />
      </g>}
      <g className="sleep-wave-cloudscape" fill={`url(#${id}-swell)`}>
        <path opacity=".28" d="M0 80 C45 62 65 92 112 96 S180 127 260 126 S365 92 430 97 S555 52 640 76 V174 H0Z" />
        <path opacity=".38" d="M0 110 C62 93 96 105 151 128 S246 146 322 135 S427 104 495 117 S578 108 640 103 V174 H0Z" />
      </g>
      <path className="sleep-wave-mist is-back" d={SWELL_BACK} fill={`url(#${id}-swell)`} />
      <g className="sleep-wave-hills" filter={`url(#${id}-hill)`}>
        {displayed.map((s, i) => <path key={i} d={hill(s, recordedWaveCrest(s))} fill={`url(#${id}-hillfill)`} />)}
        {model.active && <path d={hill(model.active, recordedWaveCrest(model.active))} fill={`url(#${id}-hillfill)`} />}
        {nextWave && <path className="is-next" d={hill(nextWave, recordedWaveCrest(nextWave))} />}
        {model.predicted.filter(p => !p.isNext && p.wave).map(p => <path key={p.sequenceIndex} className="is-later"
          style={{ opacity: laterOpacity(p.sequenceIndex) * .6 }} d={hill(p.wave!, recordedWaveCrest(p.wave!))} fill={`url(#${id}-hillfill)`} />)}
      </g>
      {model.forecasts.map((forecast, i) => {
        const x0 = forecast.start * 640, x1 = forecast.end * 640, mid = (x0 + x1) / 2;
        return <g key={i} data-wave-forecast="onset">
          <ellipse className="sleep-wave-band-glow" cx={mid} cy="150" rx={(x1 - x0) / 2 + 34} ry="80" fill={`url(#${id}-glow)`} clipPath={`url(#${id}-sky)`} />
          <path className="sleep-wave-band" d={`M ${x0} 150 V 62 Q ${x0} 52 ${mid} 52 Q ${x1} 52 ${x1} 62 V 150 Z`} fill={`url(#${id}-band)`} filter={`url(#${id}-feather)`} />
          <path className="sleep-wave-forecast-edge" d={`M ${x0} 150 V 60 M ${x1} 150 V 60`} />
          <path className="sleep-wave-onset" d={`M ${forecast.likely * 640} 150 V 104`} />
        </g>;
      })}
      {model.predicted.filter(p => !p.isNext).map(p => {
        const x0 = p.onset.start * 640, x1 = p.onset.end * 640;
        return <g key={p.sequenceIndex} data-wave-predicted={p.sequenceIndex} className={`sleep-wave-later is-depth-${p.sequenceIndex}`} style={{ opacity: laterOpacity(p.sequenceIndex) }}>
          <path style={{ opacity: p.wave ? .08 : .3 }} className="sleep-wave-later-band" d={`M ${x0} 150 V 70 Q ${x0} 62 ${(x0 + x1) / 2} 62 Q ${x1} 62 ${x1} 70 V 150 Z`} fill={`url(#${id}-band)`} />
          {p.wave && <path className="sleep-wave-predicted" d={recordedWavePath(p.wave)} fill={`url(#${id}-${p.sequenceIndex === 1 ? "next" : "predicted"})`} />}
        </g>;
      })}
      {nextWave && <path className="sleep-wave-halo is-next" d={recordedWavePath(nextWave)} filter={`url(#${id}-soft)`} />}
      {nextWave && <><path className="sleep-wave-predicted is-next" d={recordedWavePath(nextWave)} fill={`url(#${id}-next)`} /><path d={recordedWavePath(nextWave)} fill={`url(#${id}-inner)`} /></>}
      <line className="sleep-wave-baseline" x1="0" x2="640" y1="150" y2="150" />
      {recorded && <path className="sleep-wave-halo" d={recorded} filter={`url(#${id}-soft)`} />}
      {recorded && <path className="sleep-wave-recorded" d={recorded} fill={`url(#${id}-recorded)`} />}
      {model.active && <g data-wave-active="true">
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-active)`} />
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-inner)`} />
        <path d={recordedWavePath(model.active)} fill={`url(#${id}-stripes)`} />
      </g>}
      <path className="sleep-wave-mist is-mid" d={SWELL_MID} fill={`url(#${id}-swell)`} />
      <path className="sleep-wave-mist is-front" d={SWELL_FRONT} fill={`url(#${id}-swell)`} />
      <g className="sleep-wave-now-marker" style={{ transform: `translateX(${model.now * 640}px)` }}>
        <path d="M-4 0 L4 0 L7 150 L-7 150Z" fill={`url(#${id}-beam)`} opacity=".14" />
        <line y1="0" y2="150" style={{ stroke: `url(#${id}-beam)` }} />
        <circle className="sleep-wave-now-halo" cy="150" r="16" fill={`url(#${id}-glow)`} />
        <circle cy="150" r="3.5" />
      </g>
    </svg>
    <div className="sleep-wave-axis">
      {model.ticks.map((tick, index) => sparse && index % 2 ? null : <span key={tick.instant}
        className={compact ? "" : index === 0 ? "is-first" : index === model.ticks.length - 1 ? "is-last" : ""}
        style={{ left: `${tick.position * 100}%` }}>
        {compact ? tickLabels[index].slice(0, 2) : tickLabels[index]}
        {tick.showDate && <small>{new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short" }).format(tick.instant)}</small>}
        {tick.showOffset && <small>{new Intl.DateTimeFormat(LOCALES[lang], { timeZoneName: "shortOffset" }).formatToParts(tick.instant).find(p => p.type === "timeZoneName")?.value}</small>}
      </span>)}
    </div>
  </div>;
}
