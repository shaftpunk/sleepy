import "./DiaperModal.css";
﻿import { useId, useRef, useState } from "react";
import { useModalAccessibility } from "../hooks/useModalAccessibility";
import { useTranslation } from "../i18n";
import { createDiaperChange, deleteDiaperChange, diaperTypes, updateDiaperChange, type DiaperChange, type DiaperType } from "../services/diaperService";

export default function DiaperModal({ babyId, change, allowDelete, initialTime, onClose, onSaved }: {
  babyId: string;
  change?: DiaperChange;
  allowDelete?: boolean;
  initialTime?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const busy = useRef(false);
  const dialogRef = useModalAccessibility(() => { if (!busy.current) onClose(); });
  const [type, setType] = useState<DiaperType | null>(change?.type ?? null);
  const [time, setTime] = useState(() => {
    const now = change ? new Date(change.changed_at) : initialTime ?? new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(removing = false) {
    if ((!removing && (!type || !time)) || busy.current) return;
    busy.current = true;
    setSaving(true);
    setFailed(false);
    try {
      if (removing && change) {
        await deleteDiaperChange(change.id, babyId);
      } else if (type) {
        const changedAt = new Date(time).toISOString();
        if (change) await updateDiaperChange(change.id, babyId, type, changedAt);
        else await createDiaperChange(babyId, type, changedAt);
      }
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <div className="modal-backdrop">
    <div className="feed-modal diaper-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
      <div className="modal-header">
        <h2 id={titleId}>{t(change ? "diaper.edit" : "diaper.title")}</h2>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label={t("common.close")}>&times;</button>
      </div>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="diaper-types" role="group" aria-label={t("diaper.title")}>
          {diaperTypes.map(value => <button key={value} type="button" className="secondary-button"
            disabled={saving} aria-pressed={type === value} onClick={() => setType(value)}>{t(`diaper.${value}`)}</button>)}
        </div>
        <label className="form-field">
          <span>{t("diaper.time")}</span>
          <input className="datetime-input" type="datetime-local" required value={time} disabled={saving}
            onChange={event => setTime(event.target.value)} />
        </label>
        {failed && <p className="form-error" role="alert">{t("diaper.error")}</p>}
        <button className="primary-button" type="submit" disabled={!type || saving}>
          {t(saving ? "common.saving" : "common.save")}
        </button>
        {allowDelete && change && <button type="button" className="secondary-button" disabled={saving}
          onClick={() => { if (window.confirm(t("diaper.delete"))) void save(true); }}>
          {t("home.deleteDiaper")}
        </button>}
      </form>
    </div>
  </div>;
}
