import { useId, useState, type ReactNode } from "react";

import {
  createManualSleep,
  deleteSleep,
  updateSleep,
  updateActiveSleepStart,
  type SleepRecord,
} from "../services/sleepService";

import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";
import SleepSoundActivity from "./SleepSoundActivity";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

type Props = {
  sleep?: SleepRecord | null;
  allowDelete?: boolean;
  activeDetails?: ReactNode;
  initialTime?: Date;
  onSplit?: () => void;
  onResume?: () => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
};

function localDateTime(date: string | Date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset() * 60000;

  return new Date(d.getTime() - offset)
    .toISOString()
    .slice(0, 16);
}

export default function SleepModal({
  sleep,
  allowDelete,
  activeDetails,
  initialTime,
  onSplit,
  onResume,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalAccessibility(onClose);

  const currentBabyId = useAppStore(
    (state) => state.currentBabyId,
  );

  const babies = useAppStore(
    (state) => state.babies,
  );

  const currentBaby = babies.find(
    (baby) => baby.id === currentBabyId,
  );

  const now = initialTime ?? new Date();

  const defaultStart = new Date(
    now.getTime() - 60 * 60000,
  );

  const [start, setStart] = useState(
    localDateTime(
      sleep?.starttime ?? defaultStart,
    ),
  );

  const [end, setEnd] = useState(
    localDateTime(
      sleep?.endtime ?? now,
    ),
  );

  const [rate, setRate] = useState<
    number | null
  >(
    sleep?.rate
      ? Number(sleep.rate)
      : null,
  );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const active = Boolean(sleep && !sleep.endtime);

  async function resume() {
    if (!onResume || saving || !window.confirm(t("history.confirmResumeSleep"))) return;
    setSaving(true);
    setError("");
    try {
      await onResume();
      onClose();
    } catch {
      setError(t("errors.couldNotResumeSleep"));
    } finally {
      setSaving(false);
    }
  }

  async function save(removing = false) {
    if (saving) return;
    if (!currentBabyId) {
      setError(t("errors.noBabySelected"));
      return;
    }

    try {
      setSaving(true);
      setError("");

      if (removing && sleep?.endtime) {
        await deleteSleep(sleep.id);
        await onSaved();
        onClose();
        return;
      }

      const starttime =
        new Date(start).toISOString();

      const endtime =
        active ? new Date().toISOString() : new Date(end).toISOString();

      if (
        new Date(endtime) <=
        new Date(starttime)
      ) {
        setError(
          t("errors.endTimeAfterStart"),
        );

        return;
      }

      const rateValue =
        rate != null
          ? String(rate)
          : null;

      if (sleep && active) {
        await updateActiveSleepStart(sleep, starttime);
      } else if (sleep) {
        await updateSleep(
          sleep.id,
          starttime,
          endtime,
          rateValue,
        );
      } else {
        await createManualSleep({
          baby_id: currentBabyId,
          starttime,
          endtime,
          rate: rateValue,
        });
      }

      await onSaved();
      onClose();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error && err.message === t("sleepStart.overlap") ? err.message : t("errors.couldNotSaveSleep"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop sleep-detail-backdrop"
      onClick={onClose}
    >
      <div
        className="feed-modal sleep-detail-modal"
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">
              {currentBaby?.name ??
                t("common.appName")}
            </p>

            <h2 id={titleId}>
              {sleep
                ? t("sleep.editTitle")
                : t("sleep.addTitle")}
            </h2>
          </div>

          <button
            className="modal-close"
            type="button" aria-label={t("common.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <label className="form-field">
          <span>{t("sleep.fellAsleep")}</span>

          <input
            className="datetime-input"
            type="datetime-local"
            value={start}
            onChange={(event) =>
              setStart(
                event.target.value,
              )
            }
          />
        </label>

        {!active && <><label className="form-field">
          <span>{t("sleep.wokeUp")}</span>

          <input
            className="datetime-input"
            type="datetime-local"
            value={end}
            onChange={(event) =>
              setEnd(
                event.target.value,
              )
            }
          />
        </label>

        <div className="form-field">
          <span>{t("sleep.quality")}</span>

          <div className="star-picker">
            {[1, 2, 3, 4, 5].map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    rate != null &&
                    value <= rate
                      ? "star-button active"
                      : "star-button"
                  }
                  onClick={() =>
                    setRate(
                      rate === value
                        ? null
                        : value,
                    )
                  }
                  aria-label={t("sleep.rateAria", { value })}
                  aria-pressed={rate === value}
                >
                  ★
                </button>
              ),
            )}
          </div>
        </div>

        </>}

        {active && activeDetails}
        {sleep?.endtime && !sleep.deleted_at && <SleepSoundActivity key={sleep.id} sleep={sleep} />}

        {error && (
          <p className="form-error">
            {error}
          </p>
        )}

        <button
          className="primary-button"
          onClick={() => void save()}
          disabled={
            saving ||
            !currentBabyId
          }
        >
          {saving
            ? t("common.saving")
            : sleep
              ? t("common.saveChanges")
              : t("sleep.addTitle")}
        </button>
        {onSplit && <button type="button" className="secondary-button" disabled={saving} onClick={onSplit}>
          {t("sleep.splitButton")}
        </button>}
        {onResume && <button type="button" className="secondary-button" disabled={saving} onClick={() => void resume()}>
          {t("history.resumeSleepTitle")}
        </button>}
        {allowDelete && sleep?.endtime && <button type="button" className="secondary-button" disabled={saving}
          onClick={() => { if (window.confirm(t("common.confirmDeleteSleep"))) void save(true); }}>
          {t("common.deleteSleepAria")}
        </button>}
      </div>
    </div>
  );
}
