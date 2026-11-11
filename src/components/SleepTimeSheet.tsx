import { useId, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { localDateTimeInput, maximumBackdate, minutesBeforeNow } from "../lib/sleepActionTime";

type Props = { babyName: string; ending: boolean; after: number | null; disabled: boolean;
  onClose: () => void; onCommit: (minutes: number) => Promise<boolean> };
export default function SleepTimeSheet({ babyName, ending, after, disabled, onClose, onCommit }: Props) {
  const { t } = useTranslation();
  const title = useId(), busy = useRef(false);
  const [saving, setSaving] = useState(false), [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => localDateTimeInput(Date.now()));
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openedAt] = useState(Date.now);
  const ref = useModalAccessibility(onClose, !saving);
  const maximum = maximumBackdate(openedAt, after, ending);
  async function commit(minutes: number | null) {
    if (busy.current || disabled) return;
    if (minutes === null) { setInvalid(true); return; }
    busy.current = true; setSaving(true); setFailed(false);
    try { if (await onCommit(minutes)) onClose(); else setFailed(true); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className="modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
    <div className="feed-modal sleep-time-sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby={title}
      onClick={event => event.stopPropagation()}>
      <div className="modal-header">
        <h2 id={title}>{t(ending ? "home.whenWoke" : "home.whenAsleep", { name: babyName })}</h2>
        <button type="button" className="modal-close" aria-label={t("common.close")} disabled={saving} onClick={onClose}>×</button>
      </div>
      {failed && <p role="alert">{t("errors.couldNotSaveSleep")}</p>}
      <div className="sleep-time-presets">
        {[0, 5, 10, 15, 20].map(minutes => <button key={minutes} type="button" className="secondary-button"
          disabled={disabled || saving || minutes > maximum} onClick={() => void commit(minutes)}>
          {minutes === 0 ? t("sleepStart.now") : t("sleepStart.minutesAgo", { minutes })}
        </button>)}
      </div>
      <button type="button" className="text-button" aria-expanded={custom} onClick={() => setCustom(!custom)} disabled={saving}>
        {t("home.chooseTime")}
      </button>
      {custom && <form onSubmit={event => { event.preventDefault(); void commit(minutesBeforeNow(value, Date.now(), after, ending)); }}>
        <label className="form-field"><span>{t("home.chooseTime")}</span>
          <input type="datetime-local" value={value} max={localDateTimeInput(openedAt)}
            min={after === null ? undefined : localDateTimeInput(after)} required disabled={saving || disabled}
            aria-invalid={invalid} onChange={event => { setValue(event.target.value); setInvalid(false); }} />
        </label>
        {invalid && <p role="alert">{t("home.invalidActionTime")}</p>}
        <button type="submit" className="primary-button" disabled={saving || disabled}>
          {t(saving ? "common.saving" : ending ? "home.stopSleep" : "home.startSleep")}
        </button>
      </form>}
    </div>
  </div>;
}
