import { useId, useState } from "react";
import { parseLocalDateOnly } from "../analytics/localDate";
import { RHYTHM_PAGE_DAYS, visibleRhythmDays, type RhythmBlock, type RhythmDay } from "../analytics/sleepRhythm";
import { LOCALES, useTranslation } from "../i18n";
import { formatClock, formatDuration } from "../lib/format";
import "./SleepRhythm.css";

const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const dayPercent = (minute: number) => minute / 1440 * 100 + "%";

export default function SleepRhythm({ days }: { days: RhythmDay[] }) {
  const { t, lang } = useTranslation();
  const heading = useId();
  const [requestedDays, setRequestedDays] = useState(RHYTHM_PAGE_DAYS);
  const [selected, setSelected] = useState<string>();
  const visibleDays = visibleRhythmDays(days, requestedDays);
  const weekday = new Intl.DateTimeFormat(LOCALES[lang], { weekday: "short" });
  const dateLabel = new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: "full" });

  function describe(block: RhythmBlock) {
    const start = formatClock(block.startMs, lang);
    const end = block.active ? t("sleepInsights.rhythmNow") : block.endsAtMidnight ? "24:00" : formatClock(block.endMs, lang);
    return start + "\u2013" + end + " \u00b7 " + formatDuration((block.endMs - block.startMs) / 60000, lang);
  }

  return <section className="sleep-insights-card sleep-rhythm" aria-labelledby={heading}>
    <h2 id={heading}>{t("sleepInsights.rhythm")}</h2>
    <p>{t("sleepInsights.rhythmDescription")}</p>
    <div className="sleep-rhythm-axis" aria-hidden="true">
      {hours.map(hour => <span key={hour} style={{ left: hour / 24 * 100 + "%" }}>{String(hour).padStart(2, "0")}</span>)}
    </div>
    <ol className="sleep-rhythm-days">
      {visibleDays.map(({ dayKey, blocks }, index) => {
        const day = parseLocalDateOnly(dayKey)!;
        const summaryId = heading + "-" + dayKey;
        const selectedBlock = blocks.find(block => dayKey + ":" + block.id === selected);
        return <li key={dayKey} aria-describedby={summaryId}>
          <span className="sleep-rhythm-label" aria-hidden="true">
            {index === 0 ? t("common.today") : index === 1 ? t("common.yesterday") : weekday.format(day)}
          </span>
          <span id={summaryId} className="insights-visually-hidden">
            {dateLabel.format(day)}. {blocks.length
              ? t("sleepInsights.rhythmSummary") + " " + blocks.map(describe).join("; ")
              : t("sleepInsights.missing")}
          </span>
          <div className="sleep-rhythm-track">
            {blocks.map(block => {
              const id = dayKey + ":" + block.id;
              return block.pieces.map((piece, part) => <button key={id + ":" + part} type="button"
                className="sleep-rhythm-block" aria-label={describe(block)} aria-pressed={id === selected}
                tabIndex={part ? -1 : undefined}
                style={{ left: dayPercent(piece.startMinute), width: dayPercent(piece.endMinute - piece.startMinute) }}
                onClick={() => setSelected(current => current === id ? undefined : id)}
              />);
            })}
          </div>
          {selectedBlock && <output className="sleep-rhythm-detail">{describe(selectedBlock)}</output>}
        </li>;
      })}
    </ol>
    {visibleDays.length < days.length && <button type="button" className="sleep-rhythm-more"
      onClick={() => setRequestedDays(count => count + RHYTHM_PAGE_DAYS)}>
      <span aria-hidden="true">+</span> {t("sleepInsights.rhythmMore")}
    </button>}
  </section>;
}
