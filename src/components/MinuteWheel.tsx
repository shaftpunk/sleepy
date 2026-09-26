import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "../i18n";

const ROW_HEIGHT = 44;
const WHEEL_MAX = 1440;
const MINUTES = Array.from({ length: WHEEL_MAX + 1 }, (_, index) => index);

export default function MinuteWheel({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const selected = Number(value);
  const valid = /^\d+$/.test(value) && Number.isSafeInteger(selected) && selected >= 0;
  const options = valid && selected > WHEEL_MAX ? [...MINUTES, selected] : MINUTES;
  const selectedIndex = valid ? Math.min(selected, WHEEL_MAX + 1) : 0;
  const scrollSelection = useRef(0);

  useLayoutEffect(() => {
    if (scrollSelection.current === selectedIndex) return;
    scrollSelection.current = selectedIndex;
    viewport.current?.scrollTo({ top: selectedIndex * ROW_HEIGHT, behavior: "instant" });
  }, [selectedIndex]);

  function choose(index: number) {
    const next = Math.max(0, Math.min(options.length - 1, index));
    onChange(String(options[next]));
  }

  return <div className="minute-picker" data-disabled={disabled}>
    <div className="minute-wheel-frame">
      <div className="minute-wheel-selection" aria-hidden="true" />
      <div
        ref={viewport}
        className="minute-wheel"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={t("sleepStart.custom")}
        aria-valuemin={0}
        aria-valuemax={options[options.length - 1]}
        aria-valuenow={valid ? selected : 0}
        aria-valuetext={valid && selected > 0
          ? t("sleepStart.minutesAgo", { minutes: selected }) : t("sleepStart.now")}
        aria-disabled={disabled}
        onKeyDown={(event) => {
          if (disabled) return;
          const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
          if (event.key in steps || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            choose(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : selectedIndex + steps[event.key]);
          }
        }}
        onScroll={(event) => {
          if (disabled) return;
          const index = Math.max(0, Math.min(options.length - 1, Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)));
          if (index !== scrollSelection.current) {
            scrollSelection.current = index;
            onChange(String(options[index]));
          }
        }}
      >
        {options.map((minute, index) => <div
          key={minute}
          className={valid && minute === selected ? "minute-wheel-row selected" : "minute-wheel-row"}
          aria-hidden="true"
          onClick={() => { if (!disabled) choose(index); }}
        >
          {minute === 0 ? t("sleepStart.now") : t("sleepStart.preset", { minutes: minute })}
        </div>)}
      </div>
    </div>
    <label className="sleep-start-custom">
      <span>{t("sleepStart.custom")}</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={value}
        disabled={disabled} aria-invalid={!valid} onChange={(event) => onChange(event.target.value)} />
    </label>
  </div>;
}
